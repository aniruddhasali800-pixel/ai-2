// Reads a Mongoose schema for what it says about each field, and nothing else.
//
// The schemas in src/models stay exactly as they are: they are the declaration of shape, defaults
// and validation, which is still worth having. What goes away is Mongoose as a *driver* — the
// documents live in JSON lines on the local drive instead. To write them out and read them back
// the store has to know which paths hold a Date and which hold an id, because JSON has neither, so
// this walks the same schema and answers that question.
import { Types } from 'mongoose';
import type { Schema } from 'mongoose';

export type FieldKind = 'date' | 'id' | 'string' | 'number' | 'boolean' | 'mixed' | 'object';

const HEX_ID = /^[a-f0-9]{24}$/;

/** Dotted path -> kind, including paths inside arrays of subdocuments (`items.addons.price`). */
export class Descriptor {
  private readonly kinds = new Map<string, FieldKind>();
  private readonly secrets = new Set<string>();

  constructor(readonly schema: Schema) {
    this.read(schema.paths, '');
    // A document array's element fields live on the child schema, which schema.paths does not
    // flatten, so they are walked separately with the array's own path as their prefix.
    for (const [path, type] of Object.entries(schema.paths as Record<string, any>)) {
      if (type?.instance === 'Array' && type.schema) {
        this.kinds.set(path, 'object');
        this.read(type.schema.paths, path);
      }
    }
  }

  private read(paths: Record<string, any>, prefix: string) {
    for (const [name, type] of Object.entries(paths)) {
      const path = prefix ? `${prefix}.${name}` : name;
      const instance = type?.instance;
      if (!instance) continue;
      if (type?.options?.select === false) this.secrets.add(path);
      if (instance === 'Date') this.kinds.set(path, 'date');
      else if (instance === 'ObjectID') this.kinds.set(path, 'id');
      else if (instance === 'String') this.kinds.set(path, 'string');
      else if (instance === 'Number') this.kinds.set(path, 'number');
      else if (instance === 'Boolean') this.kinds.set(path, 'boolean');
      else if (instance === 'Array') this.kinds.set(path, type.schema ? 'object' : scalarKind(type.caster?.instance));
      else if (instance === 'Mixed' || instance === 'SchemaArray') this.kinds.set(path, 'mixed');
      else if (instance === 'DocumentArray' || instance === 'Embedded') this.kinds.set(path, 'object');
      else this.kinds.set(path, 'mixed');
    }
  }

  kindOf(path: string): FieldKind | undefined {
    return this.kinds.get(path);
  }

  /**
   * Paths the schema keeps off a query unless the caller asks for them by name (`select: false`),
   * which is how a password hash never reaches an endpoint that did not ask to see it.
   */
  hidden(): string[] {
    return [...this.secrets];
  }

  /** Unique index specs, so the store can refuse a duplicate the way the database did. */
  uniqueIndexes(): { paths: string[]; partial?: Record<string, unknown> }[] {
    const out: { paths: string[]; partial?: Record<string, unknown> }[] = [];
    for (const [spec, options] of this.schema.indexes() as [Record<string, unknown>, Record<string, any>][]) {
      if (!options?.unique) continue;
      out.push({ paths: Object.keys(spec), partial: options.partialFilterExpression });
    }
    return out;
  }
}

function scalarKind(instance: string | undefined): FieldKind {
  if (instance === 'Date') return 'date';
  if (instance === 'ObjectID') return 'id';
  if (instance === 'String') return 'string';
  if (instance === 'Number') return 'number';
  if (instance === 'Boolean') return 'boolean';
  return 'mixed';
}

/** JSON has no date and no object id: they go out as an ISO string and a 24-character hex. */
export function serialize(descriptor: Descriptor, value: unknown, path = ''): unknown {
  const kind = descriptor.kindOf(path);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map((v) => serialize(descriptor, v, path));
  if (value && typeof value === 'object') {
    if (kind === 'id') return String(value);
    if (kind === 'mixed') return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serialize(descriptor, v, path ? `${path}.${key}` : key);
    }
    return out;
  }
  if (kind === 'date' && typeof value === 'string') return value;
  return value;
}

/** The same walk the other way, driven by the schema rather than by markers in the file. */
export function revive(descriptor: Descriptor, value: unknown, path = ''): unknown {
  const kind = descriptor.kindOf(path);
  if (kind === 'date' && typeof value === 'string') {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? value : at;
  }
  if (kind === 'id' && typeof value === 'string' && HEX_ID.test(value)) return new Types.ObjectId(value);
  if (Array.isArray(value)) return value.map((v) => revive(descriptor, v, path));
  if (value && typeof value === 'object' && kind !== 'mixed' && !(value instanceof Types.ObjectId)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = revive(descriptor, v, path ? `${path}.${key}` : key);
    }
    return out;
  }
  return value;
}

export { HEX_ID };
