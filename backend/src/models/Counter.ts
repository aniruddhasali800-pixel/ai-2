import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, required: true, default: 0 },
});

export type Counter = InferSchemaType<typeof counterSchema>;
export const CounterModel = defineModel('Counter', counterSchema) as unknown as Model<Counter>;

/** Atomically increments a named counter (daily order/bill numbering). */
export async function nextSeq(key: string): Promise<number> {
  const doc = await CounterModel.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).lean();
  return doc!.seq;
}
