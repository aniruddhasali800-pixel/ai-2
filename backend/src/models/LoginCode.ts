import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';

/**
 * A one-time sign-in code for a staff phone. Only the hash is stored, it is worth minutes, and
 * a spent or exhausted code is useless even if it is still on disk.
 */
const loginCodeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    phoneDigits: { type: String, required: true, index: true },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Mongo drops each document at its own expiresAt, so spent and stale codes need no janitor.
loginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type LoginCode = InferSchemaType<typeof loginCodeSchema>;
export const LoginCodeModel = defineModel('LoginCode', loginCodeSchema) as unknown as Model<LoginCode>;
