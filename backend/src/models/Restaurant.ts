import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { FLOOR_ROLES } from '../types/constants';

const restaurantSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    address: {
      line1: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    currency: { type: String, default: 'INR' },
    taxPercent: { type: Number, default: 5, min: 0, max: 28 },
    serviceChargePercent: { type: Number, default: 0, min: 0, max: 20 },
    hours: {
      open: { type: String, default: '10:00' },
      close: { type: String, default: '23:00' },
    },
    payment: {
      upiId: { type: String, trim: true, default: '' },
      upiName: { type: String, trim: true, default: '' },
    },
    branding: {
      logoUrl: { type: String, default: '' },
      coverUrl: { type: String, default: '' },
      tagline: { type: String, default: '' },
    },
    settings: {
      acceptingOrders: { type: Boolean, default: true },
      autoAcceptOrders: { type: Boolean, default: false },
      billFooterNote: { type: String, default: 'Thank you for dining with us!' },
      bookingEnabled: { type: Boolean, default: true },
      bookingSlotMinutes: { type: Number, default: 30 },
      bookingDurationMinutes: { type: Number, default: 90 },
      bookingReminderMinutes: { type: Number, default: 60 },
      allowWaiterCash: { type: Boolean, default: true },
      deliveryEnabled: { type: Boolean, default: true },
      /** Which jobs the sticker's "ask to work here" form offers. Floor jobs only, by design. */
      openRoles: {
        type: [{ type: String, enum: FLOOR_ROLES }],
        default: [...FLOOR_ROLES],
      },
    },
  },
  { timestamps: true },
);

export type Restaurant = InferSchemaType<typeof restaurantSchema>;
export const RestaurantModel = defineModel('Restaurant', restaurantSchema) as unknown as Model<Restaurant>;
