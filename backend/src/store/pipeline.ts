// The part of the aggregation framework this repository asks for, run over the documents the store
// already holds in memory.
//
// A pipeline is a list of stages, and each stage turns the documents it was handed into the documents
// it passes on; the last stage's output is the report's rows. That shape maps onto an array of
// objects once, so this file is the whole engine — no cursor, no query planner, nothing to fall back
// to. The expressions a stage evaluates are the same ones a `$expr` filter speaks, so they live in
// query.ts and are imported here rather than duplicated.
import { Types } from 'mongoose';
import { evaluateExpression, clone, matches, order, same, setValue, unsetValue, getValue } from './query';

type Doc = Record<string, any>;

/** What `$lookup` needs to reach a second collection: its documents, straight from the live store. */
export type PipelineSources = (modelReference: string) => Doc[];

export function runPipeline(docs: Doc[], pipeline: unknown[], sources: PipelineSources): Doc[] {
  let at = docs;
  for (const stage of pipeline) {
    const entries = Object.entries(stage as Doc);
    if (entries.length !== 1) {
      throw new Error(`An aggregation stage holds exactly one operator, this one holds ${entries.map(([key]) => key).join(', ')}.`);
    }
    at = applyStage(entries[0][0], at, entries[0][1], sources);
  }
  // A row is a copy: a report that prints a total must not be able to write one back into the
  // archive by editing a document it was only shown.
  return at.map((doc) => clone(doc));
}

function applyStage(op: string, docs: Doc[], arg: unknown, sources: PipelineSources): Doc[] {
  switch (op) {
    case '$match':
      return docs.filter((doc) => matches(doc, arg as Doc));
    case '$group':
      return group(docs, arg as Doc);
    case '$sort':
      return sortStage(docs, arg as Doc);
    case '$limit':
      return docs.slice(0, Number(arg));
    case '$skip':
      return docs.slice(Number(arg));
    case '$unwind':
      return unwind(docs, arg as Doc | string);
    case '$lookup':
      return lookup(docs, arg as Doc, sources);
    default:
      throw new Error(`The file store has no aggregation stage ${op}. Implement it in src/store/pipeline.ts or rewrite the pipeline.`);
  }
}

/**
 * Rows are collected under the value of `_id`, which may be null, a path, an expression such as a
 * date bucket, or an object of paths. The value itself is what the output row carries, so a waiter id
 * stays an id and a date bucket stays the label the report prints.
 */
function group(docs: Doc[], spec: Doc): Doc[] {
  const fields = Object.entries(spec).filter(([field]) => field !== '_id');
  if (!docs.length) {
    // A stage the store cannot answer is refused even on a day with no matching documents: a report
    // that replies "nothing" to a typo looks like a quiet shift rather than a broken one.
    evaluateExpression({}, spec._id);
    for (const [, accumulator] of fields) knownAccumulator(Object.keys(accumulator as Doc)[0]);
    return [];
  }

  const buckets = new Map<string, { id: unknown; rows: Doc[] }>();
  for (const doc of docs) {
    const id = evaluateExpression(doc, spec._id);
    const key = JSON.stringify(id, (_field, one) =>
      one instanceof Types.ObjectId ? `oid:${one.toHexString()}` : one instanceof Date ? `at:${one.toISOString()}` : one,
    );
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(doc);
    else buckets.set(key, { id, rows: [doc] });
  }

  const out: Doc[] = [];
  for (const { id, rows } of buckets.values()) {
    const row: Doc = { _id: id };
    for (const [field, accumulator] of fields) row[field] = accumulate(rows, accumulator as Doc);
    out.push(row);
  }
  return out;
}

const ACCUMULATORS = new Set(['$sum', '$avg', '$min', '$max', '$first', '$last', '$push', '$addToSet']);

function knownAccumulator(op: string): string {
  if (!ACCUMULATORS.has(op)) {
    throw new Error(`The file store has no accumulation operator ${op}. Implement it in src/store/pipeline.ts or rewrite the pipeline.`);
  }
  return op;
}

function accumulate(rows: Doc[], accumulator: Doc): unknown {
  const [op, arg] = Object.entries(accumulator)[0];
  knownAccumulator(op);
  // A field that is missing, or a document that has none of it, adds nothing rather than turning a
  // report total into NaN.
  const values = () =>
    rows
      .map((row) => evaluateExpression(row, arg))
      .filter((one) => one !== undefined && one !== null && one !== false)
      .map((one) => (one instanceof Date ? one.getTime() : one));
  switch (op) {
    case '$sum':
      if (arg === 1) return rows.length;
      return values().reduce((sum: number, one) => sum + (typeof one === 'number' && Number.isFinite(one) ? one : 0), 0);
    case '$avg': {
      const numbers = values().filter((one) => typeof one === 'number') as number[];
      return numbers.length ? numbers.reduce((sum, one) => sum + one, 0) / numbers.length : null;
    }
    case '$min':
      return endValue(values(), 'min');
    case '$max':
      return endValue(values(), 'max');
    case '$first':
      return values()[0] ?? null;
    case '$last': {
      const list = values();
      return list[list.length - 1] ?? null;
    }
    case '$push':
      return rows.map((row) => evaluateExpression(row, arg));
    case '$addToSet': {
      const seen: unknown[] = [];
      for (const value of rows.map((row) => evaluateExpression(row, arg))) {
        if (!seen.some((has) => same(has, value))) seen.push(value);
      }
      return seen;
    }
    default:
      throw new Error(`The file store has no accumulation operator ${op}. Implement it in src/store/pipeline.ts or rewrite the pipeline.`);
  }
}

function endValue(values: unknown[], want: 'min' | 'max'): unknown {
  if (!values.length) return null;
  return values.reduce((best, one) => (order(one, best) * (want === 'min' ? 1 : -1) < 0 ? one : best));
}

function sortStage(docs: Doc[], spec: Doc): Doc[] {
  const keys = Object.entries(spec).map(([path, direction]) => [path, Number(direction) < 0 ? -1 : 1] as [string, number]);
  return [...docs].sort((a, b) => {
    for (const [path, direction] of keys) {
      const result = order(a[path], b[path]);
      if (result !== 0) return result * direction;
    }
    return 0;
  });
}

/**
 * `$unwind` spreads one document per element of an array, which is how a report counts a line item
 * rather than an order. `preserveNullAndEmptyArrays` keeps the document when the array is not there,
 * which is what a joined lookup needs so an unknown product still shows up in the list.
 */
function unwind(docs: Doc[], arg: Doc | string): Doc[] {
  const path = typeof arg === 'string' ? arg : String(arg.path);
  const keepEmpty = typeof arg === 'string' ? false : Boolean(arg.preserveNullAndEmptyArrays);
  const out: Doc[] = [];
  for (const doc of docs) {
    const list = evaluateExpression(doc, path);
    const elements = Array.isArray(list) ? list : list === undefined || list === null ? [] : [list];
    if (!elements.length) {
      if (keepEmpty) {
        const once: Doc = { ...doc };
        unsetValue(once, path.slice(1));
        out.push(once);
      }
      continue;
    }
    for (const one of elements) out.push({ ...doc, [path.slice(1)]: one });
  }
  return out;
}

/** A simple join: every document of another collection whose `foreignField` equals this row's `localField`. */
function lookup(docs: Doc[], arg: Doc, sources: PipelineSources): Doc[] {
  const { from, localField, foreignField, as } = arg as { from: string; localField: string; foreignField: string; as: string };
  if (!from || !localField || !foreignField || !as) {
    throw new Error('The file store joins with $lookup in its from/localField/foreignField/as form only.');
  }
  const others = sources(from);
  return docs.map((doc) => {
    const local = getValue(doc, localField);
    const next: Doc = { ...doc };
    setValue(next, as, clone(others.filter((other) => same(local, getValue(other, foreignField)))));
    return next;
  });
}
