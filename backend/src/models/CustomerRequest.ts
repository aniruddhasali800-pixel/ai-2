import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { REQUEST_TYPES } from '../types/constants';

const customerRequestSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    tableSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true },
    type: { type: String, enum: REQUEST_TYPES, required: true },
    note: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['OPEN', 'ACKNOWLEDGED', 'DONE'], default: 'OPEN' },
    /** Who raised the call. A waiter asking for a clear is answered by the counter, so the
     *  reply has to travel back to the raise rather than to whoever holds the table now. */
    raisedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    handledByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
    /** A guest asking to pay in cash is a request that carries the bill it is about. */
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', default: null },
    /** Cash the waiter took at the table; the counter confirms it against this figure. */
    tendered: { type: Number, default: null },
    collectedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    collectedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

customerRequestSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });

export type CustomerRequest = InferSchemaType<typeof customerRequestSchema>;
export const CustomerRequestModel = defineModel('CustomerRequest', customerRequestSchema) as unknown as Model<CustomerRequest>;
