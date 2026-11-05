import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';

/**
 * A one-time verification or login code sent to an email address.
 * Only the hash is stored, with an automatic TTL expiration.
 */
const emailCodeSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: false },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    codeHash: { type: String, required: true, select: false },
    purpose: { type: String, enum: ['STAFF_INVITE', 'STAFF_LOGIN', 'APPLICANT_VERIFY'], default: 'STAFF_INVITE' },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// MongoDB automatically drops expired codes
emailCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type EmailCode = InferSchemaType<typeof emailCodeSchema>;
export const EmailCodeModel = defineModel('EmailCode', emailCodeSchema) as unknown as Model<EmailCode>;
