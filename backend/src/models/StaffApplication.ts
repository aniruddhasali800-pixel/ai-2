import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { FLOOR_ROLES } from '../types/constants';

/**
 * A walk-in's request to work here. It arrives with no account behind it, so it carries only
 * what the applicant typed plus the phone we can reach them on. Nothing about it is trusted:
 * the role is always one of the floor jobs, and an account exists only after a manager or the
 * owner accepts it.
 */
const staffApplicationSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    /** Typed as it arrives, so the queue shows what the person actually gave us. */
    phone: { type: String, required: true, trim: true },
    /** Digits only — the key we match on when they later ask for a sign-in code. */
    phoneDigits: { type: String, required: true, index: true },
    role: { type: String, enum: FLOOR_ROLES, required: true },
    note: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, default: '' },
    decidedAt: { type: Date, default: null },
    /** The account approval created, so the queue can show "Ravi · active since Tuesday". */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

staffApplicationSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
// One live request per phone per restaurant; a second one overwrites nothing, it is refused.
staffApplicationSchema.index(
  { restaurantId: 1, phoneDigits: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);

export type StaffApplication = InferSchemaType<typeof staffApplicationSchema>;
export const StaffApplicationModel = defineModel('StaffApplication', staffApplicationSchema) as unknown as Model<StaffApplication>;
