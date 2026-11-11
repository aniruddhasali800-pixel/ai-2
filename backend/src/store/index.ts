// The store's front door: it registers a collection for each schema, loads the folder tree into
// memory at boot, and answers where a document's file lives.
//
// Restaurant folders are bound from the disk rather than recomputed from the name, so renaming a
// restaurant does not strand yesterday's bills in a folder nothing points at any more.
import { rm } from 'node:fs/promises';
import mongoose from 'mongoose';
import type { Schema } from 'mongoose';
import { Collection } from './collection';
import { Descriptor } from './descriptor';
import { absolute, getRoot, listFiles, readText, setRoot, topFolders, walk, writeText } from './io';
import { LAYOUT, fileFor, slugFor, type Layout } from './layout';
import type { Doc, FileModel } from './types';

const collections = new Map<string, Collection>();
const layouts = new Map<string, Layout>();
/** Which restaurant id owns which folder on disk, learned by reading it. */
const folders = new Map<string, string>();
const idsByFolder = new Map<string, string>();
/** Folder names present on the drive, so nothing new is ever written over an old restaurant's. */
const reserved = new Set<string>();
let loaded = false;

const UNASSIGNED = '_unassigned';

function folderOf(restaurantId: unknown): string {
  if (!restaurantId) return UNASSIGNED;
  const key = String(restaurantId);
  return folders.get(key) ?? UNASSIGNED;
}

function bind(restaurantId: unknown, folder: string): void {
  const key = String(restaurantId);
  if (!key || key === 'undefined' || key === 'null') return;
  if (folders.get(key) === folder) return;
  const owner = idsByFolder.get(folder);
  if (owner && owner !== key) {
    console.warn(`[store] folder ${folder} already belongs to another restaurant; ignoring ${key}`);
    return;
  }
  const previous = folders.get(key);
  if (previous && previous !== folder) {
    console.warn(`[store] restaurant ${key} appears in two folders, ${previous} and ${folder}; keeping ${previous}`);
    return;
  }
  folders.set(key, folder);
  idsByFolder.set(folder, key);
}

/** Registers the model a src/models file declares, and hands back the file-backed stand-in. */
export function defineModel<T = Doc>(name: string, schema: Schema): FileModel<T> {
  const layout = LAYOUT.find((entry) => entry.model === name);
  if (!layout) throw new Error(`[store] ${name} has no entry in src/store/layout.ts, so the store does not know where to keep it.`);
  const real = (mongoose.models[name] ?? mongoose.model(name, schema)) as mongoose.Model<unknown>;
  const descriptor = new Descriptor(schema);
  const collection = new Collection(real, descriptor, layout, (doc) =>
    fileFor(layout, layout.scope === 'global' ? null : folderOf(doc.restaurantId), doc),
  );
  if (layout.model === 'Restaurant') collection.onCreated = adoptRestaurant;
  collection.lookups = documentsNamed;
  collections.set(name, collection);
  layouts.set(name, layout);
  return collection as unknown as FileModel<T>;
}

/**
 * `$lookup` names the collection the way MongoDB did, lower-case and plural — `users`, `products`,
 * `categories` — so a join is answered by that name rather than by the folder the records live in.
 */
function documentsNamed(reference: string): Doc[] {
  const want = String(reference).toLowerCase();
  for (const other of collections.values()) {
    const model = other.modelName.toLowerCase();
    if (model === want || pluralOf(model) === want) return other.allDocs();
  }
  throw new Error(`[store] an aggregation $lookup asked for ${reference}, which is not a collection this store holds.`);
}

function pluralOf(word: string): string {
  return word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/**
 * A restaurant's folder is named the moment the restaurant is, and anything already stored under its
 * id — the owner's login is usually written first — is re-filed into it. Without this the archive
 * would keep a `_unassigned` half that nothing reads.
 */
async function adoptRestaurant(restaurant: Doc): Promise<void> {
  claimFolder(restaurant._id, String(restaurant.name ?? ''));
  for (const other of collections.values()) {
    if (other.layout.scope === 'restaurant') await other.rescan();
  }
}

function fileNameOf(model: string): string {
  return `${layouts.get(model)!.file}.jsonl`;
}

/** Reads every file already on the drive. Called once, before the first request. */
export async function startStore(dir?: string): Promise<{ files: number; documents: number }> {
  if (dir) setRoot(dir);
  if (loaded) return { files: 0, documents: 0 };
  const byName = new Map<string, Collection>();
  for (const [model, collection] of collections) byName.set(fileNameOf(model), collection);

  for (const folder of await topFolders()) reserved.add(folder);

  const files = await walk();
  let documents = 0;
  for (const file of files) {
    const collection = byName.get(file.split('/').pop()!);
    if (!collection) {
      console.warn(`[store] ignoring ${file}: no collection writes that file name`);
      continue;
    }
    const read = await collection.load(file);
    documents += read.length;
    if (collection.layout.scope !== 'restaurant') continue;
    // The folder a record was read from is the answer to who owns it; the name is never recomputed
    // from the restaurant, so renaming one leaves its history exactly where it was.
    const top = file.split('/')[0];
    if (top === UNASSIGNED) continue;
    for (const doc of read) bind(doc.restaurantId, top);
  }
  // A record filed before its restaurant had a folder — or by an older version of this code — is
  // moved into the tree the store now reads, so the drive holds one copy of every document.
  for (const collection of collections.values()) await collection.rescan();
  await releaseEmptyFolders();
  loaded = true;
  return { files: files.length, documents };
}

/**
 * A restaurant folder that holds no records is the shell left behind by a rebuild, so it is deleted
 * and its name becomes free again. Without this, wiping and reseeding leaves "Saffron & Smoke"
 * standing beside "Saffron & Smoke 2", and every later install climbs that ladder one rung higher.
 */
async function releaseEmptyFolders(): Promise<void> {
  const inUse = new Set<string>();
  for (const collection of collections.values()) {
    if (collection.layout.scope !== 'restaurant') continue;
    for (const doc of collection.allDocs()) inUse.add(folderOf(doc.restaurantId));
  }
  for (const folder of [...reserved]) {
    if (folder.startsWith('_') || inUse.has(folder)) continue;
    reserved.delete(folder);
    const owner = idsByFolder.get(folder);
    if (owner) folders.delete(owner);
    idsByFolder.delete(folder);
    await rm(absolute(folder), { recursive: true, force: true });
  }
}

/** A new restaurant gets a folder from its name, kept for the life of the process. */
export function claimFolder(restaurantId: unknown, name: string): string {
  const key = String(restaurantId);
  if (folders.has(key)) return folders.get(key)!;
  const base = slugFor(name);
  let folder = base;
  let suffix = 2;
  while (reserved.has(folder) || (idsByFolder.has(folder) && idsByFolder.get(folder) !== key)) folder = `${base} ${suffix++}`;
  folders.set(key, folder);
  idsByFolder.set(folder, key);
  reserved.add(folder);
  return folder;
}

export function folderForRestaurant(restaurantId: unknown): string | null {
  return folders.get(String(restaurantId)) ?? null;
}

export function collectionFor(name: string): Collection {
  const found = collections.get(name);
  if (!found) throw new Error(`[store] ${name} was never registered`);
  return found;
}

export function root(): string {
  return getRoot();
}

/**
 * Writes a generated file inside the archive — a day-close report and its CSV — through the same
 * atomic path the records use, so a report can never be half-written on a crash.
 */
export async function writeArchiveFile(file: string, text: string): Promise<string> {
  await writeText(file, text);
  return file;
}

export async function readArchiveFile(file: string): Promise<string | null> {
  return readText(file);
}

/** The names already written in one folder, newest first, so a report list needs no database. */
export async function listArchiveFiles(dir: string): Promise<string[]> {
  return (await listFiles(dir)).sort().reverse();
}

/** Every file the store holds open on the drive, with how many records each carries. */
export function inventory(): { file: string; documents: number }[] {
  const out: { file: string; documents: number }[] = [];
  for (const [model, collection] of collections) {
    for (const file of collection.files()) out.push({ file, documents: [...collection.docs.values()].filter((d) => collection.fileFor(d) === file).length });
    void model;
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Between tests: forget everything and start from an empty folder. */
export function resetStore(): void {
  for (const collection of collections.values()) {
    collection.docs.clear();
    collection.written.clear();
  }
  folders.clear();
  idsByFolder.clear();
  reserved.clear();
  loaded = false;
}

/**
 * Empties the archive on the drive as well as in memory. A fresh install and the test suite both
 * need the guarantee that nothing from a previous run is still being read.
 */
export async function clearArchive(): Promise<void> {
  // Refusing before a start is deliberate: with no folder on record this would fall back to the
  // default path and delete a developer's real archive.
  if (!loaded) throw new Error('[store] refusing to clear an archive that was never opened');
  resetStore();
  await rm(getRoot(), { recursive: true, force: true });
}

/**
 * Empties every registered collection in place. Unlike clearing the archive, the restaurant-to-folder
 * bindings survive, so a rebuilt tenant is filed in the same folder as the records it replaced and the
 * history of anyone else sharing the drive is untouched.
 */
export async function clearCollections(): Promise<number> {
  if (!loaded) throw new Error('[store] refusing to clear collections that were never opened');
  let cleared = 0;
  for (const collection of collections.values()) cleared += (await collection.deleteMany({})).deletedCount;
  // The records are gone, so the folders they lived in are shells; releasing them here means the next
  // restaurant of the same name is filed under its own name rather than a numbered copy of it.
  await releaseEmptyFolders();
  return cleared;
}

export { LAYOUT };
export type { FileModel };
