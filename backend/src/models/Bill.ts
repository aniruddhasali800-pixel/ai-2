import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { BILL_STATUSES } from '../types/constants';

const billSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    billNumber: { type: String, required: true },
    orderIds: [{ type: Schema.Types.ObjectId, ref: 'Order', required: true }],
    tableSessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', default: null },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', default: null },
    tableNumber: { type: String, default: '' },
    customerName: { type: String, trim: true, default: '' },
    subtotal: { type: Number, required: true, default: 0 },
    taxTotal: { type: Number, required: true, default: 0 },
    serviceCharge: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true, default: 0 },
    taxBreakup: [
      {
        _id: false,
        label: { type: String, required: true },
        percent: { type: Number, required: true },
        amount: { type: Number, required: true },
      },
    ],
    status: { type: String, enum: BILL_STATUSES, default: 'ISSUED' },
    paymentStatus: { type: String, enum: ['UNPAID', 'PAID', 'REFUNDED'], default: 'UNPAID' },
    publicToken: { type: String, required: true, unique: true },
    /** Null when the guest's own "bill please" tap issued it — no staff member pressed the button. */
    issuedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    issuedAt: { type: Date, default: () => new Date() },
    paidAt: { type: Date, default: null },
    printCount: { type: Number, default: 0 },
    lastPrintedAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

billSchema.index({ restaurantId: 1, billNumber: 1 }, { unique: true });
billSchema.index({ restaurantId: 1, createdAt: -1 });
billSchema.index({ restaurantId: 1, paymentStatus: 1 });

export type Bill = InferSchemaType<typeof billSchema>;
export const BillModel = defineModel('Bill', billSchema) as unknown as Model<Bill>;
