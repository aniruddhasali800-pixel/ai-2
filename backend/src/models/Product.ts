import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { STATIONS } from '../types/constants';

const productSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, trim: true, default: '' },
    taxPercent: { type: Number, default: null },
    isVeg: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    station: { type: String, enum: STATIONS, default: 'MAIN' },
    sortOrder: { type: Number, default: 0 },
    prepMinutes: { type: Number, default: 15, min: 1 },
    addonIds: [{ type: Schema.Types.ObjectId, ref: 'Addon' }],
    recipe: [
      {
        _id: false,
        inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
        qty: { type: Number, required: true, min: 0 },
      },
    ],
    tags: [{ type: String, trim: true }],
  },
  { timestamps: true },
);

productSchema.index({ restaurantId: 1, categoryId: 1, sortOrder: 1 });
productSchema.index({ restaurantId: 1, name: 1 });

export type Product = InferSchemaType<typeof productSchema>;
export const ProductModel = defineModel('Product', productSchema) as unknown as Model<Product>;
