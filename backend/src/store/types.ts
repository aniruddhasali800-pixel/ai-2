import type { Schema } from 'mongoose';
import type { Descriptor } from './descriptor';
import type { Layout } from './layout';

export type Doc = Record<string, any>;

export interface StoreContext {
  /** The folder this document's file lives in, under the archive root. */
  fileFor(doc: Doc): string;
  descriptor: Descriptor;
  layout: Layout;
  modelName: string;
}

/** The chainable result a call site awaits, shaped like the query it replaces. */
export interface Found<T = Doc> extends Promise<T> {
  lean(): Found<T>;
  sort(spec: unknown): Found<T>;
  limit(n: number): Found<T>;
  skip(n: number): Found<T>;
  select(spec: unknown): Found<T>;
  exec(): Promise<T>;
}

export interface FileModel<T = Doc> {
  modelName: string;
  schema: Schema;
  find(filter?: Doc, projection?: unknown): Found<T[]>;
  findOne(filter?: Doc, options?: Doc): Found<T | null>;
  findById(id: unknown): Found<T | null>;
  create(payload: Doc | Doc[]): Promise<any>;
  insertMany(payloads: Doc[]): Promise<any[]>;
  updateOne(filter: Doc, update: Doc, options?: Doc): Promise<UpdateResult>;
  updateMany(filter: Doc, update: Doc, options?: Doc): Promise<UpdateResult>;
  findOneAndUpdate(filter: Doc, update: Doc, options?: Doc): Found<any>;
  findByIdAndUpdate(id: unknown, update: Doc, options?: Doc): Found<any>;
  findOneAndDelete(filter: Doc, options?: Doc): Found<any>;
  findByIdAndDelete(id: unknown): Found<any>;
  deleteOne(filter: Doc): Promise<{ acknowledged: boolean; deletedCount: number }>;
  deleteMany(filter: Doc): Promise<{ acknowledged: boolean; deletedCount: number }>;
  countDocuments(filter?: Doc): Found<number>;
  count(filter?: Doc): Found<number>;
  estimatedDocumentCount(): Found<number>;
  exists(filter: Doc): Found<any>;
  distinct(path: string, filter?: Doc): Promise<unknown[]>;
  bulkWrite(ops: Doc[]): Promise<{ acknowledged: boolean; insertedCount: number; matchedCount: number; modifiedCount: number; deletedCount: number; upsertedCount: number }>;
  hydrate(doc: Doc): T;
  aggregate(pipeline: unknown[]): Promise<Doc[]>;
}

export interface UpdateResult {
  acknowledged: boolean;
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: string | null;
  n: number;
  nModified: number;
}
