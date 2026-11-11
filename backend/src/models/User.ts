import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { ROLES } from '../types/constants';
import { phoneDigits } from '../utils/phone';

const userSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    phone: { type: String, trim: true, unique: true, sparse: true },
    /** The same phone with everything but digits removed, so a code request can find an
     *  account however the number was typed when it was created. */
    phoneDigits: { type: String, index: true },
    /** Not `required`: refreshing and signing out read the row for its tokens only, and saving
     *  that document would fail validation if Mongoose demanded a hash it was never allowed to
     *  see. Sign-in selects the field and refuses when it is absent. */
    passwordHash: { type: String, select: false },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    /** One hash per signed-in device, newest last. A floor phone and the counter screen run the
     *  same job account, so a fresh sign-in must not end the session already on that account. */
    refreshTokens: { type: [String], select: false, default: [] },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.pre('save', function stampPhoneDigits(next) {
  if (this.isModified('phone') || this.phoneDigits == null) {
    this.phoneDigits = phoneDigits(this.phone);
  }
  next();
});

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = defineModel('User', userSchema) as unknown as Model<User>;
