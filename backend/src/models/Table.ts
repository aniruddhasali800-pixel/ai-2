import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { TABLE_STATUSES } from '../types/constants';

const tableSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    number: { type: String, required: true, trim: true },
    capacity: { type: Number, required: true, min: 1, default: 4 },
    section: { type: String, trim: true, default: 'Main' },
    description: { type: String, trim: true, default: '' },
    status: { type: String, enum: TABLE_STATUSES, default: 'AVAILABLE', index: true },
    qrToken: { type: String, required: true, unique: true },
    activeSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', default: null },
    assignedWaiterId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastCleanedAt: { type: Date },
  },
  { timestamps: true },
);

tableSchema.index({ restaurantId: 1, number: 1 }, { unique: true });
tableSchema.index({ restaurantId: 1, status: 1 });

export type Table = InferSchemaType<typeof tableSchema>;
export const TableModel = defineModel('Table', tableSchema) as unknown as Model<Table>;
