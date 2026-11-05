import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { ROLES } from '../types/constants';
import { phoneDigits } from '../utils/phone';

const userSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    clerkUserId: { type: String, index: true, sparse: true },
    role: { type: String, enum: ROLES, required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true, sparse: true, index: true },
    phone: { type: String, trim: true, sparse: true, index: true },
    /** The same phone with everything but digits removed, so a code request can find an
     *  account however the number was typed when it was created. */
    phoneDigits: { type: String, index: true },
    /** Not `required`: Clerk handles passwords for web users. Left optional for legacy/seeded staff. */
    passwordHash: { type: String, select: false },
    status: { type: String, enum: ['ACTIVE', 'PENDING', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    employeeId: { type: String, trim: true, sparse: true },
    department: { type: String, trim: true, default: '' },
    dateOfJoining: { type: Date },
    workingDays: { type: [String], default: [] },
    workingHours: { type: String, default: '' },
    shift: { type: String, default: '' },
    invitationStatus: { type: String, enum: ['NONE', 'PENDING', 'ACCEPTED', 'EXPIRED'], default: 'NONE' },
    invitationId: { type: String, sparse: true },
    assignedTables: { type: [String], default: [] },
    workArea: { type: String, default: '' },
    permissions: { type: [String], default: [] },
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
