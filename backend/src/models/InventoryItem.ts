import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { INVENTORY_UNITS } from '../types/constants';

const inventoryItemSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    unit: { type: String, enum: INVENTORY_UNITS, default: 'KG' },
    stock: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 0, min: 0 },
    costPerUnit: { type: Number, default: 0, min: 0 },
    supplier: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

inventoryItemSchema.index({ restaurantId: 1, name: 1 }, { unique: true });

export type InventoryItem = InferSchemaType<typeof inventoryItemSchema>;
export const InventoryItemModel = defineModel('InventoryItem', inventoryItemSchema) as unknown as Model<InventoryItem>;
