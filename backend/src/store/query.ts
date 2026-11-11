// The query language the 336 call sites in this repository actually use, in plain JavaScript.
//
// Every operator here exists because something in src/ asks for it; nothing is implemented on
// spec. The rule for the whole file is that a filter or an update is applied to a JavaScript
// object that has already been revived to its real types, so a Date compares as a Date and an id
// compares as an id — never as a string that happens to look alike.
import { Types } from 'mongoose';

type Doc = Record<string, any>;
const HEX_ID = /^[a-f0-9]{24}$/;

export function getValue(doc: unknown, path: string): unknown {
  if (path === '_id') return (doc as Doc)._id;
  let at: unknown = doc;
  for (const part of path.split('.')) {
    if (at === null || at === undefined) return undefined;
    if (Array.isArray(at) && /^\d+$/.test(part)) at = (at as unknown[])[Number(part)];
    else if (Array.isArray(at) && !(part in (at as object))) {
      // Mongo reaches through an array of subdocuments, which is how `items.productId` is queried.
      const nested = (at as unknown[]).map((v) => getValue(v, part));
      return nested.some((v) => v !== undefined) ? nested : undefined;
    } else at = (at as Doc)[part];
  }
  return at;
}

export function setValue(doc: Doc, path: string, value: unknown): void {
  const parts = path.split('.');
  let at: Doc = doc;
  for (const part of parts.slice(0, -1)) {
    if (typeof at[part] !== 'object' || at[part] === null) at[part] = {};
    at = at[part];
  }
  at[parts[parts.length - 1]] = value;
}

export function unsetValue(doc: Doc, path: string): void {
  const parts = path.split('.');
  let at: Doc = doc;
  for (const part of parts.slice(0, -1)) {
    if (typeof at[part] !== 'object' || at[part] === null) return;
    at = at[part];
  }
  delete at[parts[parts.length - 1]];
}

/** An id may arrive as a hex string from an HTTP param and be stored as an ObjectId. */
function sameId(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v instanceof Types.ObjectId) return v.toHexString();
    if (typeof v === 'string' && HEX_ID.test(v)) return v;
    return null;
  };
  const [x, y] = [norm(a), norm(b)];
  return x !== null && y !== null && x === y;
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'string') return a.getTime() === new Date(b).getTime();
  if (typeof a === 'string' && b instanceof Date) return new Date(a).getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return a === b || (a ?? null) === (b ?? null);
  if (sameId(a, b)) return true;
  if (Array.isArray(a) && !Array.isArray(b)) return a.some((v) => same(v, b));
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function compare(a: unknown, b: unknown): number | null {
  if (a === undefined || a === null) return null;
  if (a instanceof Date || typeof a === 'string') {
    const left = a instanceof Date ? a.getTime() : Date.parse(String(a));
    const right = b instanceof Date ? b.getTime() : typeof b === 'number' ? b : Date.parse(String(b));
    if (Number.isNaN(left) || Number.isNaN(right)) return null;
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof a === 'number' && (typeof b === 'number' || b instanceof Date)) {
    const right = b instanceof Date ? b.getTime() : b;
    return a === right ? 0 : a < right ? -1 : 1;
  }
  return null;
}

function matchesOne(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof Types.ObjectId) && !Array.isArray(expected)) {
    return Object.entries(expected as Record<string, unknown>).every(([op, want]) => {
      switch (op) {
        case '$in':
          return (want as unknown[]).some((v) => same(actual, v));
        case '$nin':
          return !(want as unknown[]).some((v) => same(actual, v));
        case '$ne':
          return !same(actual, want);
        case '$eq':
          return same(actual, want);
        case '$gt': {
          const c = compare(actual, want);
          return c !== null && c > 0;
        }
        case '$gte': {
          const c = compare(actual, want);
          return c !== null && c >= 0;
        }
        case '$lt': {
          const c = compare(actual, want);
          return c !== null && c < 0;
        }
        case '$lte': {
          const c = compare(actual, want);
          return c !== null && c <= 0;
        }
        case '$exists':
          return (actual !== undefined) === Boolean(want);
        case '$regex': {
          const re = want instanceof RegExp ? want : new RegExp(String(want), (expected as Doc).$options ?? '');
          return typeof actual === 'string' && re.test(actual);
        }
        case '$options':
          return true;
        case '$size':
          return Array.isArray(actual) && actual.length === want;
        case '$all':
          return Array.isArray(actual) && (want as unknown[]).every((v) => actual.some((a) => same(a, v)));
        case '$elemMatch':
          return Array.isArray(actual) && actual.some((v) => (typeof want === 'object' && want !== null && !Array.isArray(want) ? matches(v as Doc, want as Doc) : same(v, want)));
        case '$not':
          return !matchesOne(actual, want);
        case '$type':
          return typeOf(actual) === want;
        default:
          throw new Error(`The file store has no operator ${op}. Implement it in src/store/query.ts or rewrite the query.`);
      }
    });
  }
  return same(actual, expected);
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return 'date';
  if (value instanceof Types.ObjectId) return 'objectId';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

export function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, want]) => {
    if (key === '$or') return (want as Doc[]).some((sub) => matches(doc, sub));
    if (key === '$and') return (want as Doc[]).every((sub) => matches(doc, sub));
    if (key === '$nor') return !(want as Doc[]).some((sub) => matches(doc, sub));
    // `$expr` is the only way two fields of the same document can be compared, which is how the
    // stock list finds an item already below its own threshold and a booking finds its own overlap.
    if (key === '$expr') return evaluate(doc, want as Doc);
    if (key.startsWith('$')) throw new Error(`The file store has no top-level operator ${key}.`);
    const actual = getValue(doc, key);
    if (Array.isArray(actual) && !isOperatorObject(want)) {
      // A stored array matches a scalar the way Mongo does: any element equal to it.
      return actual.some((v) => same(v, want)) || same(actual, want);
    }
    return matchesOne(actual, want);
  });
}

/** One aggregation expression, evaluated against a single document. */
export function evaluateExpression(doc: Doc, operand: unknown): unknown {
  return resolve(doc, operand);
}

function resolve(doc: Doc, operand: unknown): unknown {
  if (typeof operand === 'string' && operand.startsWith('$')) return getValue(doc, operand.slice(1));
  if (!operand || typeof operand !== 'object' || Array.isArray(operand) || operand instanceof Date || operand instanceof Types.ObjectId) {
    return operand;
  }
  const [op, raw] = Object.entries(operand as Doc)[0] ?? [];
  if (!op) return operand;
  // An object whose first key is not an operator is a shape built out of expressions, which is what
  // a `$group` key like `{ productId: '$items.productId', name: '$items.name' }` is.
  if (!op.startsWith('$')) {
    return Object.fromEntries(Object.entries(operand as Doc).map(([key, one]) => [key, resolve(doc, one)]));
  }
  // Operators that read their arguments themselves, rather than as arithmetic operands.
  if (op === '$switch' || op === '$dateToString' || op === '$hour' || op === '$let') {
    return dateOrBranch(doc, op, raw as Doc);
  }
  const args = Array.isArray(raw) ? raw.map((one) => resolve(doc, one)) : [resolve(doc, raw)];
  switch (op) {
    case '$add':
      return args.reduce((sum: number, one) => sum + toNumber(one), 0);
    case '$subtract':
      return toNumber(args[0]) - args.slice(1).reduce<number>((left, one) => left + toNumber(one), 0);
    case '$multiply':
      return args.reduce((product: number, one) => product * toNumber(one), 1);
    case '$divide':
      return toNumber(args[0]) / args.slice(1).reduce<number>((left, one) => left * toNumber(one), 1);
    case '$max':
      return args.reduce((best, one) => ((compare(one, best) ?? 0) > 0 ? one : best));
    case '$min':
      return args.reduce((best, one) => ((compare(one, best) ?? 0) < 0 ? one : best));
    case '$cond': {
      const [test, thenValue, elseValue] = args;
      return truthy(test) ? thenValue : elseValue;
    }
    case '$ifNull':
      return args.find((one) => one !== null && one !== undefined) ?? null;
    case '$in':
      // The expression form takes `[value, list]`, which is how a report folds six order sources
      // into three channels. The filter form, `{ field: { $in: [...] } }`, lives in matchesOne.
      return ((args[1] as unknown[]) ?? []).some((one) => same(args[0], one));
    case '$eq':
      return same(args[0], args[1]);
    case '$ne':
      return !same(args[0], args[1]);
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte': {
      const c = compare(args[0], args[1]);
      if (c === null) return false;
      return op === '$gt' ? c > 0 : op === '$gte' ? c >= 0 : op === '$lt' ? c < 0 : c <= 0;
    }
    default:
      throw new Error(`The file store cannot evaluate the expression ${op}. Implement it in src/store/query.ts or rewrite the query.`);
  }
}

/** The expressions that take a document of their own rather than a list of operands. */
function dateOrBranch(doc: Doc, op: string, spec: Doc): unknown {
  if (op === '$switch') {
    const hit = ((spec.branches as { case: unknown; then: unknown }[]) ?? []).find((one) => truthy(resolve(doc, one.case)));
    return hit ? resolve(doc, hit.then) : resolve(doc, spec.default);
  }
  if (op === '$hour') {
    const at = resolve(doc, spec.date ?? spec);
    const zone = typeof spec.timezone === 'string' ? spec.timezone : undefined;
    return validDate(at) ? zoneParts(at as Date, zone).hour : null;
  }
  if (op === '$dateToString') {
    const at = resolve(doc, spec.date);
    if (!validDate(at)) return null;
    const parts = zoneParts(at as Date, typeof spec.timezone === 'string' ? spec.timezone : undefined);
    return formatDate(String(spec.format), parts);
  }
  throw new Error(`The file store cannot evaluate the expression ${op}. Implement it in src/store/query.ts or rewrite the query.`);
}

function validDate(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The wall clock an employee in that timezone reads, asked of the platform's own timezone table so no
 * list of offsets has to be kept beside this code. Without a timezone the instant is read as UTC.
 */
function zoneParts(value: Date | string, timezone?: string): { year: number; month: number; day: number; hour: number } {
  const at = value instanceof Date ? value : new Date(value);
  if (!timezone) {
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate(), hour: at.getUTCHours() };
  }
  let formatter = zoneFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    zoneFormatters.set(timezone, formatter);
  }
  const read: Partial<Record<string, number>> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== 'literal') read[part.type] = Number(part.value);
  }
  return { year: read.year!, month: read.month!, day: read.day!, hour: read.hour === 24 ? 0 : read.hour! };
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** The `%`-codes this repository asks for: calendar date, ISO week, month, year, and hour. */
function formatDate(format: string, parts: { year: number; month: number; day: number; hour: number }): string {
  const [isoYear, isoWeek] = isoWeekOf(parts.year, parts.month, parts.day);
  return format.replace(/%[YmdHGV]/g, (code) => {
    switch (code) {
      case '%Y':
        return String(parts.year);
      case '%m':
        return pad(parts.month);
      case '%d':
        return pad(parts.day);
      case '%H':
        return pad(parts.hour);
      case '%G':
        return String(isoYear);
      case '%V':
        return pad(isoWeek);
      default:
        throw new Error(`The file store cannot format the date code ${code}. Implement it in src/store/query.ts or rewrite the format.`);
    }
  });
}

/** ISO-8601 says the year a date belongs to is the year of the Thursday in its week. */
function isoWeekOf(year: number, month: number, day: number): [number, number] {
  const date = new Date(Date.UTC(year, month - 1, day));
  const shifted = new Date(date);
  shifted.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(shifted.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((shifted.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return [shifted.getUTCFullYear(), week];
}

/** A date is its own number in arithmetic, exactly as a Mongo timestamp is in `$add`. */
function toNumber(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function truthy(value: unknown): boolean {
  return value !== false && value !== null && value !== undefined;
}

function evaluate(doc: Doc, expr: Doc): boolean {
  return Object.entries(expr).every(([op, raw]) => {
    const args = (Array.isArray(raw) ? raw : [raw]) as unknown[];
    if (op === '$and') return (args as Doc[]).every((one) => evaluate(doc, one));
    if (op === '$or') return (args as Doc[]).some((one) => evaluate(doc, one));
    if (op === '$not') return !evaluate(doc, args[0] as Doc);
    const left = resolve(doc, args[0]);
    const right = resolve(doc, args[1]);
    switch (op) {
      case '$eq':
        return same(left, right);
      case '$ne':
        return !same(left, right);
      case '$gt':
        return compare(left, right) !== null && compare(left, right)! > 0;
      case '$gte':
        return compare(left, right) !== null && compare(left, right)! >= 0;
      case '$lt':
        return compare(left, right) !== null && compare(left, right)! < 0;
      case '$lte':
        return compare(left, right) !== null && compare(left, right)! <= 0;
      case '$in':
        return (args[1] as unknown[]).some((one) => same(left, one));
      default:
        throw new Error(`The file store cannot evaluate the expression ${op}. Implement it in src/store/query.ts or rewrite the query.`);
    }
  });
}

function isOperatorObject(want: unknown): boolean {
  return !!want && typeof want === 'object' && !(want instanceof Date) && !(want instanceof Types.ObjectId) && !Array.isArray(want)
    && Object.keys(want as object).some((k) => k.startsWith('$'));
}

/** Applies an update document in place and reports whether anything changed. */
export function applyUpdate(doc: Doc, update: Doc, options: { onInsert?: Doc } = {}): boolean {
  if (Array.isArray(update)) {
    // An update written as a list of stages is Mongoose's aggregation-pipeline form, and it is how
    // a field is set from the document's own current value: `[{ $set: { stock: { $max: [0,
    // { $add: ['$stock', delta] }] } } }]` clamps a deduction at zero. Each stage sees what the
    // stage before it left behind, and every value is an expression rather than a literal.
    let touched = false;
    for (const stage of update as unknown as Doc[]) {
      for (const [op, payload] of Object.entries(stage)) {
        if (op !== '$set') {
          throw new Error(`The file store applies only $set inside a pipeline update, not ${op}. Implement it in src/store/query.ts or rewrite the update.`);
        }
        for (const [path, raw] of Object.entries(payload as Doc)) {
          const before = getValue(doc, path);
          const value = resolve(doc, raw);
          setValue(doc, path, value === undefined ? null : value);
          touched = touched || !same(before, value);
        }
      }
    }
    return touched;
  }
  const operators = Object.keys(update).filter((k) => k.startsWith('$'));
  if (!operators.length) {
    // An update with no atomic operators is a `$set` in Mongoose's reading of it — that is what
    // `updateOne({ _id }, { lastActivityAt: new Date() })` means, and swapping the whole document
    // here would erase every field the caller never mentioned.
    let touched = false;
    for (const [path, value] of Object.entries(update)) {
      const before = getValue(doc, path);
      setValue(doc, path, value);
      touched = touched || !same(before, value);
    }
    return touched;
  }
  let touched = false;
  for (const op of operators) {
    const payload = update[op] as Record<string, unknown>;
    for (const [path, raw] of Object.entries(payload)) {
      if (op === '$set') {
        const before = getValue(doc, path);
        setValue(doc, path, raw === undefined ? null : raw);
        touched = touched || !same(before, raw);
      } else if (op === '$unset') {
        unsetValue(doc, path);
        touched = true;
      } else if (op === '$inc') {
        const at = (getValue(doc, path) as number | undefined) ?? 0;
        setValue(doc, path, Number(at) + Number(raw));
        touched = true;
      } else if (op === '$min' || op === '$max') {
        const at = getValue(doc, path) as number | undefined;
        const c = compare(at, raw);
        const take = op === '$min' ? c === null || (c !== null && c > 0) : c === null || (c !== null && c < 0);
        if (take) {
          setValue(doc, path, raw);
          touched = true;
        }
      } else if (op === '$currentDate') {
        setValue(doc, path, new Date());
        touched = true;
      } else if (op === '$setOnInsert') {
        if (options.onInsert) setValue(doc, path, raw);
      } else if (op === '$push') {
        const modifiers = raw && typeof raw === 'object' && '$each' in (raw as Doc) ? (raw as Doc) : null;
        const added = (modifiers ? modifiers.$each : [raw]) as unknown[];
        const list = (getValue(doc, path) as unknown[] | undefined) ?? [];
        let next = modifiers?.$position === 0 ? [...added, ...list] : [...list, ...added];
        // `$slice` trims what ends up stored: a negative count keeps the newest tail, which is how a
        // sign-in list holds the last few devices and forgets the ones that fell off the front.
        const take = modifiers?.$slice;
        if (typeof take === 'number') next = take < 0 ? next.slice(take) : next.slice(0, take);
        setValue(doc, path, next);
        touched = true;
      } else if (op === '$addToSet') {
        const list = (getValue(doc, path) as unknown[] | undefined) ?? [];
        const wanted = raw && typeof raw === 'object' && '$each' in (raw as Doc) ? (raw as Doc).$each : [raw];
        setValue(doc, path, [...list, ...(wanted as unknown[]).filter((v) => !list.some((has) => same(has, v)))]);
        touched = true;
      } else if (op === '$pull') {
        const list = (getValue(doc, path) as unknown[] | undefined) ?? [];
        setValue(doc, path, list.filter((v) => !matchesOne(v, raw)));
        touched = true;
      } else if (op === '$pop') {
        const list = [...((getValue(doc, path) as unknown[] | undefined) ?? [])];
        list.splice(Number(raw) === -1 ? 0 : -1, 1);
        setValue(doc, path, list);
        touched = true;
      } else {
        throw new Error(`The file store has no update operator ${op}.`);
      }
    }
  }
  return touched;
}

export function sortDocs(docs: Doc[], spec: string | Doc | unknown[][]): Doc[] {
  const keys: [string, number][] =
    typeof spec === 'string'
      ? spec.split(/\s+/).filter(Boolean).map((part) => (part.startsWith('-') ? [part.slice(1), -1] : [part, 1]) as [string, number])
      : Array.isArray(spec)
        ? (spec as [string, number | string][]).map(([k, v]) => [k, String(v).startsWith('-') ? -1 : 1] as [string, number])
        : Object.entries(spec as Doc).map(([k, v]) => [k, Number(v) < 0 ? -1 : 1] as [string, number]);
  if (!keys.length) return docs;
  return [...docs].sort((a, b) => {
    for (const [path, direction] of keys) {
      const left = getValue(a, path);
      const right = getValue(b, path);
      const c = order(left, right);
      if (c !== 0) return c * direction;
    }
    return 0;
  });
}

export function order(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (a instanceof Date || b instanceof Date) {
    const x = a instanceof Date ? a.getTime() : Date.parse(String(a));
    const y = b instanceof Date ? b.getTime() : Date.parse(String(b));
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  const [x, y] = [String(a), String(b)];
  return x === y ? 0 : x < y ? -1 : 1;
}

/** `_id` always survives a projection: a document without its identity is not a document. */
/**
 * A projection, in the three forms the codebase uses: a space-separated string, an object of 1/0,
 * and the `+`/`-` prefixes. `+field` adds one the schema keeps hidden; a plain list replaces the
 * document, keeping only what is named. Nothing here mutates the stored document — it builds a copy.
 */
export function project(doc: Doc, spec: unknown, hidden: string[] = []): Doc {
  const entries = parseSelect(spec);
  if (!entries.length) return drop(doc, hidden);
  const include = entries.filter(([, mode]) => mode === 'include').map(([path]) => path);
  const add = entries.filter(([, mode]) => mode === 'add').map(([path]) => path);
  const exclude = entries.filter(([, mode]) => mode === 'exclude').map(([path]) => path);

  // A `+field`-only projection asks for one hidden field on top of the whole document, not for a
  // new shape; naming a field plainly replaces the document with just what is named.
  const out: Doc = {};
  if (include.length) {
    for (const path of include) {
      const value = getValue(doc, path);
      if (value !== undefined) setValue(out, path, clone(value));
    }
    if (doc._id !== undefined) out._id = doc._id;
  } else {
    Object.assign(out, drop(doc, hidden));
  }
  for (const path of add) {
    const value = getValue(doc, path);
    if (value !== undefined) setValue(out, path, clone(value));
  }
  for (const path of exclude) unsetValue(out, path);
  return out;
}

function drop(doc: Doc, hidden: string[]): Doc {
  const out = clone(doc);
  for (const path of hidden) unsetValue(out, path);
  return out;
}

/** The select spec as `[path, mode]` pairs, where mode says how the path combines with the rest. */
function parseSelect(spec: unknown): [string, 'include' | 'exclude' | 'add'][] {
  if (!spec) return [];
  const pairs: [string, string | number | boolean][] =
    typeof spec === 'string'
      ? spec
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => [part, part.startsWith('-') ? 0 : 1] as [string, string | number])
      : Array.isArray(spec)
        ? (spec as [string, string | number][])
        : Object.entries(spec as Doc);
  return pairs.map(([raw, value]) => {
    const path = raw.replace(/^[+-]/, '');
    if (raw.startsWith('+')) return [path, 'add' as const];
    if (raw.startsWith('-') || value === 0 || value === false) return [path, 'exclude' as const];
    return [path, 'include' as const];
  });
}

/**
 * A copy that survives what JSON does not. structuredClone would turn an ObjectId into an object
 * holding a byte buffer, and every later cast would fail on it, so the two special types are
 * rebuilt by value and everything else is copied structurally.
 */
export function clone<T>(value: T): T {
  if (value instanceof Types.ObjectId) return new Types.ObjectId(value.toHexString()) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((one) => clone(one)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, one] of Object.entries(value as Record<string, unknown>)) out[key] = clone(one);
    return out as T;
  }
  return value;
}
