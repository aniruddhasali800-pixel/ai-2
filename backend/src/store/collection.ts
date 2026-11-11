// One collection: an in-memory map of documents, mirrored to a JSON-lines file on the local drive.
//
// It deliberately answers the same method names the Mongoose model it replaces answered, because
// there are 336 call sites across the backend and a shim that speaks their dialect is a change that
// can be proven correct. The Mongoose schema is still used — for casting, defaults and validation —
// through the real model, which is never connected to anything.
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { revive, serialize } from './descriptor';
import type { Descriptor } from './descriptor';
import { applyUpdate, clone, getValue, matches, project, setValue, sortDocs, unsetValue } from './query';
import { runPipeline } from './pipeline';
import { readLines, removeFile, writeLines } from './io';
import type { Layout } from './layout';
import type { Doc, FileModel, Found, UpdateResult } from './types';

interface Options {
  lean: boolean;
  sort?: unknown;
  limit?: number;
  skip?: number;
  select?: unknown;
}

const MISSING = Symbol('missing');

export class Collection {
  readonly docs = new Map<string, Doc>();
  /** Every file this collection has put on the drive, which `rescan` rewrites. */
  readonly written = new Set<string>();

  constructor(
    readonly real: Model<unknown>,
    readonly descriptor: Descriptor,
    readonly layout: Layout,
    readonly fileFor: (doc: Doc) => string,
  ) {}

  /** Set for the Restaurant collection, which decides where every other collection's files live. */
  onCreated?: (doc: Doc) => Promise<void>;
  /** Set by the store index so a `$lookup` stage can reach a second collection by its Mongo name. */
  lookups?: (reference: string) => Doc[];

  /** The schema stays reachable: `hydrate` needs the real model, and a reader wants the name. */
  get schema() {
    return this.real.schema;
  }

  get modelName(): string {
    return this.layout.model;
  }

  private key(id: unknown): string {
    if (id instanceof Types.ObjectId) return id.toHexString();
    return String(id ?? '');
  }

  /** Reads one file back into memory at boot. Unknown fields are kept: a hand-edited file must not lose them. */
  async load(filePath: string): Promise<Doc[]> {
    const lines = await readLines(filePath);
    const read: Doc[] = [];
    if (lines.length) this.written.add(filePath);
    for (const line of lines) {
      try {
        const parsed = revive(this.descriptor, JSON.parse(line)) as Doc;
        if (!parsed || typeof parsed !== 'object' || !parsed._id) continue;
        this.docs.set(this.key(parsed._id), parsed);
        read.push(parsed);
      } catch {
        // A torn line is skipped rather than taking the whole restaurant down with it.
        console.warn(`[store] ${filePath}: skipped an unreadable line`);
      }
    }
    return read;
  }

  /** Rewrites every file the given documents now belong to. */
  private async persist(...docs: Doc[]): Promise<void> {
    await this.writeFiles(new Set(docs.map((doc) => this.fileFor(doc))));
  }

  private async writeFiles(files: Set<string>): Promise<void> {
    await Promise.all([...files].map((file) => this.writeFile(file)));
  }

  /** Rebuilds one file from the documents that belong in it now, and removes it when none do. */
  async writeFile(file: string): Promise<void> {
    this.written.add(file);
    const lines = [...this.docs.values()]
      .filter((doc) => this.fileFor(doc) === file)
      .map((doc) => JSON.stringify(serialize(this.descriptor, doc)));
    if (!lines.length) {
      await removeFile(file);
      this.written.delete(file);
      return;
    }
    await writeLines(file, lines);
  }

  /**
   * Re-files everything this collection holds. A restaurant's folder is named when the restaurant is
   * created, and anything already stored under its id — the owner's login, in the usual order of
   * events — has to follow it out of `_unassigned`, so both the old and the new file are rewritten.
   */
  async rescan(): Promise<void> {
    const files = new Set([...this.written, ...[...this.docs.values()].map((doc) => this.fileFor(doc))]);
    this.written.clear();
    await this.writeFiles(files);
  }

  /** A model is allowed to derive a field in a `pre('save')` hook and callers rely on it, so the
   * store runs the same hooks Mongoose does, in the same place: after the document is cast and
   * before it is validated. `execPre` is exactly the call `lib/model.js` makes for `doc.save()`. */
  private async runSaveHooks(draft: any): Promise<void> {
    const hooks = (this.real.schema as any).s.hooks;
    if (!hooks.hasHooks('save')) return;
    await new Promise<void>((resolve, reject) => {
      hooks.execPre('save', draft, [{}], (error: unknown) => (error ? reject(error) : resolve()));
    });
  }

  /** Casts and validates through the schema, then adds the timestamps Mongoose would have set. */
  private async build(payload: Doc): Promise<Doc> {
    const draft = new this.real(clone(payload)) as any;
    await this.runSaveHooks(draft);
    await draft.validate();
    const doc = draft.toObject({ versionKey: false }) as Doc;
    const now = new Date();
    if (!(doc.createdAt instanceof Date)) doc.createdAt = doc.createdAt ? new Date(String(doc.createdAt)) : now;
    doc.updatedAt = now;
    await this.checkUnique(doc, MISSING);
    return doc;
  }

  private async checkUnique(candidate: Doc, except: unknown): Promise<void> {
    for (const index of this.descriptor.uniqueIndexes()) {
      const values = index.paths.map((path) => candidate[path]);
      if (values.some((v) => v === undefined)) continue;
      if (index.partial && !matches(candidate, index.partial as Doc)) continue;
      const clash = [...this.docs.values()].some(
        (doc) => this.key(doc._id) !== this.key(except === MISSING ? candidate._id : except) && index.paths.every((path, i) => matches(doc, { [path]: values[i] })),
      );
      if (clash) {
        throw Object.assign(new Error(`E11000 duplicate key error: ${this.layout.model} already has ${index.paths.join('+')}`), {
          name: 'MongoServerError',
          code: 11000,
        });
      }
    }
  }

  async insert(payload: Doc): Promise<Doc> {
    const doc = await this.store(await this.build(payload));
    if (this.onCreated) await this.onCreated(doc);
    return doc;
  }

  /** Puts an already-cast document into the map and onto the drive. */
  private async store(doc: Doc): Promise<Doc> {
    this.docs.set(this.key(doc._id), doc);
    await this.persist(doc);
    return doc;
  }

  /** The equality values an upsert carries over from the filter it matched nothing in. */
  private seedFrom(filter: Doc): Doc {
    const seed: Doc = {};
    for (const [key, want] of Object.entries(filter)) {
      if (key.startsWith('$')) continue;
      if (want && typeof want === 'object' && !(want instanceof Date) && !(want instanceof Types.ObjectId)) continue;
      seed[key] = want;
    }
    return seed;
  }

  private replaceInMemory(id: unknown, next: Doc): void {
    this.docs.set(this.key(id), next);
  }

  async remove(id: unknown): Promise<boolean> {
    const existing = this.docs.get(this.key(id));
    if (!existing) return false;
    this.docs.delete(this.key(id));
    await this.persist(existing);
    return true;
  }

  /** A hydrated document, so `.status = 'X'; await doc.save()` keeps working unchanged. */
  hydrate(doc: Doc): any {
    const stored = clone(doc);
    const hydrated = this.real.hydrate(stored) as any;
    const id = this.key(stored._id);
    hydrated.save = async () => {
      await this.runSaveHooks(hydrated);
      const next = hydrated.toObject({ versionKey: false }) as Doc;
      const previous = this.docs.get(id);
      if (!previous) return this.insert(next);
      // Only what the caller touched goes back: a document read with a partial select must not be
      // able to blank the fields it never saw — which is exactly what saving one did in MongoDB.
      const merged = clone(previous);
      for (const path of hydrated.modifiedPaths() as string[]) {
        const value = getValue(next, path);
        if (value === undefined) unsetValue(merged, path);
        else setValue(merged, path, value);
      }
      merged.updatedAt = new Date();
      const draft = new this.real(clone(merged)) as any;
      await draft.validate();
      const saved = draft.toObject({ versionKey: false }) as Doc;
      saved._id = previous._id;
      saved.createdAt = previous.createdAt;
      await this.checkUnique(saved, id);
      this.replaceInMemory(id, saved);
      await this.persist(saved, previous);
      return hydrated;
    };
    hydrated.remove = async () => {
      await this.remove(id);
      return hydrated;
    };
    return hydrated;
  }

  private plain(doc: Doc): Doc {
    return clone(doc);
  }

  private selected(doc: Doc, options: Options): Doc {
    return project(doc, options.select, this.descriptor.hidden());
  }

  private finish(docs: Doc[], options: Options, single: boolean): any {
    let out = docs;
    if (options.sort) out = sortDocs(out, options.sort);
    if (options.skip) out = out.slice(options.skip);
    if (options.limit) out = out.slice(0, options.limit);
    const shaped = out.map((doc) => (options.lean ? this.plain(this.selected(doc, options)) : this.hydrate(this.selected(doc, options))));
    return single ? (shaped[0] ?? null) : shaped;
  }

  query(run: (options: Options) => any, options: Options = { lean: false }): any {
    const self = {
      then: (onfulfilled?: (v: any) => any, onrejected?: (e: unknown) => any) => Promise.resolve().then(() => run(options)).then(onfulfilled, onrejected),
      catch: (onrejected: (e: unknown) => any) => Promise.resolve().then(() => run(options)).catch(onrejected),
      finally: (fn: () => void) => Promise.resolve().then(() => run(options)).finally(fn),
      lean: () => self.query2({ ...options, lean: true }),
      sort: (spec: unknown) => self.query2({ ...options, sort: spec }),
      limit: (n: number) => self.query2({ ...options, limit: n }),
      skip: (n: number) => self.query2({ ...options, skip: n }),
      select: (spec: unknown) => self.query2({ ...options, select: spec }),
      exec: () => Promise.resolve().then(() => run(options)),
      query2: (next: Options) => Collection.prototype.query.call(this, run, next),
    };
    return self;
  }

  private scan(filter?: Doc): Doc[] {
    const all = [...this.docs.values()];
    return !filter || Object.keys(filter).length === 0 ? all : all.filter((doc) => matches(doc, filter));
  }

  find(filter: Doc = {}, projection?: unknown): Found<any> {
    return this.query((options) => this.finish(this.scan(filter), { ...options, select: options.select ?? projection }, false));
  }

  findOne(filter: Doc = {}, options?: Doc): Found<any> {
    const sort = options?.sort as unknown;
    return this.query((o) => this.finish(this.scan(filter), { ...o, sort: o.sort ?? sort, limit: o.limit ?? 1 }, true));
  }

  findById(id: unknown): Found<any> {
    return this.query((options) => {
      const doc = this.docs.get(this.key(id));
      return this.finish(doc ? [doc] : [], options, true);
    });
  }

  exists(filter: Doc = {}): Found<any> {
    return this.query((options) => {
      const found = this.scan(filter)[0];
      return found ? { _id: this.plain(found)._id } : null;
    }, { lean: true });
  }

  async create(payload: Doc | Doc[]): Promise<any> {
    if (Array.isArray(payload)) {
      const created = [];
      for (const one of payload) created.push(this.hydrate(await this.insert(one)));
      return created;
    }
    return this.hydrate(await this.insert(payload));
  }

  /** Mongoose hands back the documents it made, and callers read ids straight off them, so the
   * driver's `{ insertedCount }` shape is not what a call site expects here. */
  async insertMany(payloads: Doc[]): Promise<any[]> {
    const created = [];
    for (const one of payloads) created.push(this.hydrate(await this.insert(one)));
    return created;
  }

  private async write(filter: Doc, update: Doc, options: Doc, single: boolean): Promise<UpdateResult> {
    const targets = this.scan(filter);
    const hits = single ? targets.slice(0, 1) : targets;
    if (!hits.length && options.upsert) {
      const seed = this.seedFrom(filter);
      applyUpdate(seed, clone(update), { onInsert: seed });
      const created = await this.insert(seed);
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: String(created._id), n: 0, nModified: 0 };
    }
    let modified = 0;
    const changed: Doc[] = [];
    for (const doc of hits) {
      const before = clone(doc);
      applyUpdate(doc, clone(update));
      if (JSON.stringify(serialize(this.descriptor, before)) !== JSON.stringify(serialize(this.descriptor, doc))) {
        // `timestamps: false` is how a caller rewrites history without the record looking like it
        // changed right now, which is exactly what seeding last week's orders has to do.
        if (options.timestamps !== false) doc.updatedAt = new Date();
        modified += 1;
        changed.push(before);
      }
    }
    for (const doc of hits) await this.checkUnique(doc, this.key(doc._id));
    if (modified) await this.persist(...hits, ...changed);
    return { acknowledged: true, matchedCount: hits.length, modifiedCount: modified, upsertedCount: 0, upsertedId: null, n: hits.length, nModified: modified };
  }

  updateOne(filter: Doc, update: Doc, options: Doc = {}): Promise<UpdateResult> {
    return this.write(filter, update, options, true);
  }

  updateMany(filter: Doc, update: Doc, options: Doc = {}): Promise<UpdateResult> {
    return this.write(filter, update, options, false);
  }

  findOneAndUpdate(filter: Doc, update: Doc, options: Doc = {}): Found<any> {
    const wantsNew = options.new === true || options.returnDocument === 'after';
    const leanResult = options.lean === true;
    return this.query(async (o) => {
      const target = this.scan(filter)[0];
      if (!target) {
        if (!options.upsert) return null;
        const seed = this.seedFrom(filter);
        applyUpdate(seed, clone(update), { onInsert: seed });
        const created = await this.insert(seed);
        return o.lean || leanResult ? this.plain(created) : this.hydrate(created);
      }
      const before = clone(target);
      applyUpdate(target, clone(update));
      target.updatedAt = new Date();
      await this.checkUnique(target, this.key(target._id));
      await this.persist(target, before);
      const chosen = wantsNew ? target : before;
      return o.lean || leanResult ? this.plain(chosen) : this.hydrate(chosen);
    });
  }

  findByIdAndUpdate(id: unknown, update: Doc, options: Doc = {}): Found<any> {
    return this.findOneAndUpdate({ _id: id }, update, options);
  }

  findOneAndDelete(filter: Doc, options: Doc = {}): Found<any> {
    return this.query(async (o) => {
      const target = this.scan(filter)[0];
      if (!target) return null;
      const before = clone(target);
      await this.remove(target._id);
      return o.lean || options.lean ? this.plain(before) : this.hydrate(before);
    });
  }

  findByIdAndDelete(id: unknown): Found<any> {
    return this.findOneAndDelete({ _id: id });
  }

  async deleteOne(filter: Doc): Promise<{ acknowledged: boolean; deletedCount: number }> {
    const target = this.scan(filter)[0];
    return { acknowledged: true, deletedCount: target && (await this.remove(target._id)) ? 1 : 0 };
  }

  async deleteMany(filter: Doc = {}): Promise<{ acknowledged: boolean; deletedCount: number }> {
    const targets = this.scan(filter);
    for (const target of targets) await this.remove(target._id);
    return { acknowledged: true, deletedCount: targets.length };
  }

  /** A count answers too, because `Model.countDocuments(q).lean()` is a call site that exists. */
  countDocuments(filter: Doc = {}): Found<number> {
    return this.query(() => this.scan(filter).length, { lean: true });
  }

  count(filter: Doc = {}): Found<number> {
    return this.countDocuments(filter);
  }

  estimatedDocumentCount(): Found<number> {
    return this.query(() => this.docs.size, { lean: true });
  }

  async distinct(path: string, filter: Doc = {}): Promise<unknown[]> {
    const seen = new Map<string, unknown>();
    for (const doc of this.scan(filter)) {
      const value = getValue(doc, path);
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one === undefined) continue;
        seen.set(typeof one === 'object' ? JSON.stringify(serialize(this.descriptor, one)) : String(one), one);
      }
    }
    return [...seen.values()];
  }

  async bulkWrite(ops: Doc[]): Promise<{ acknowledged: boolean; insertedCount: number; matchedCount: number; modifiedCount: number; deletedCount: number; upsertedCount: number }> {
    const out = { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0 };
    for (const op of ops) {
      const [kind] = Object.keys(op);
      const body = op[kind] as Doc;
      if (kind === 'insertOne') {
        await this.insert(body.document);
        out.insertedCount += 1;
      } else if (kind === 'deleteOne') {
        const target = this.scan(body.filter)[0];
        if (target && (await this.remove(target._id))) out.deletedCount += 1;
      } else if (kind === 'updateOne' || kind === 'updateMany') {
        const result = await this.write(body.filter, body.update, body, kind === 'updateOne');
        out.matchedCount += result.matchedCount;
        out.modifiedCount += result.modifiedCount;
        out.upsertedCount += result.upsertedCount;
      }
    }
    return out;
  }

  /**
   * A pipeline of stages, run over the documents this collection holds. The reports group and join
   * the way they did under MongoDB, so the stages are evaluated here instead of being rewritten a
   * second time in every caller; src/store/pipeline.ts holds the vocabulary.
   */
  async aggregate(pipeline: unknown[] = []): Promise<Doc[]> {
    return runPipeline(this.allDocs(), pipeline, (reference) => this.lookups?.(reference) ?? []);
  }

  /** Every document held, in the order it was read or written — what a `$lookup` joins against. */
  allDocs(): Doc[] {
    return [...this.docs.values()];
  }

  /** Every file this collection currently occupies, for boot and for the disk report. */
  files(): string[] {
    return [...new Set([...this.docs.values()].map((doc) => this.fileFor(doc)))];
  }
}

export type { FileModel, Found };
