import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';

const addonSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

addonSchema.index({ restaurantId: 1, name: 1 }, { unique: true });

export type Addon = InferSchemaType<typeof addonSchema>;
export const AddonModel = defineModel('Addon', addonSchema) as unknown as Model<Addon>;
