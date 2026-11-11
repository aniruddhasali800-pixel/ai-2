import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';

const categorySchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

categorySchema.index({ restaurantId: 1, sortOrder: 1 });

export type Category = InferSchemaType<typeof categorySchema>;
export const CategoryModel = defineModel('Category', categorySchema) as unknown as Model<Category>;
