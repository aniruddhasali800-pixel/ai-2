import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { BOOKING_STATUSES } from '../types/constants';

const bookingSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    customerEmail: { type: String, lowercase: true, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    startAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 90, min: 15 },
    guests: { type: Number, required: true, min: 1 },
    status: { type: String, enum: BOOKING_STATUSES, default: 'PENDING' },
    source: { type: String, enum: ['CUSTOMER', 'STAFF'], default: 'CUSTOMER' },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assignedWaiterId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reminderSentAt: { type: Date, default: null },
    statusHistory: [
      {
        _id: false,
        status: { type: String, enum: BOOKING_STATUSES },
        at: { type: Date, default: () => new Date() },
        byUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      },
    ],
  },
  { timestamps: true },
);

bookingSchema.index({ restaurantId: 1, startAt: 1 });
bookingSchema.index({ restaurantId: 1, tableId: 1, startAt: 1 });
bookingSchema.index({ restaurantId: 1, status: 1 });

export type Booking = InferSchemaType<typeof bookingSchema>;
export const BookingModel = defineModel('Booking', bookingSchema) as unknown as Model<Booking>;
