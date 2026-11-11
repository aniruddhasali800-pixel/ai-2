import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { SESSION_STATUSES } from '../types/constants';

const tableSessionSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true, index: true },
    publicToken: { type: String, required: true, unique: true },
    guestCount: { type: Number, default: 1, min: 1 },
    customerName: { type: String, trim: true, default: '' },
    status: { type: String, enum: SESSION_STATUSES, default: 'OPEN' },
    openedVia: { type: String, enum: ['QR', 'STAFF'], default: 'QR' },
    openedAt: { type: Date, default: () => new Date() },
    closedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

tableSessionSchema.index({ restaurantId: 1, status: 1 });
tableSessionSchema.index({ tableId: 1, status: 1 });

export type TableSession = InferSchemaType<typeof tableSessionSchema>;
export const TableSessionModel = defineModel('TableSession', tableSessionSchema) as unknown as Model<TableSession>;
