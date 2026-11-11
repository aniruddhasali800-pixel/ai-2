import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '../types/constants';

const paymentSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true, index: true },
    orderIds: [{ type: Schema.Types.ObjectId, ref: 'Order' }],
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    provider: { type: String, default: 'CASH' },
    amount: { type: Number, required: true, min: 0 },
    tendered: { type: Number, default: null },
    change: { type: Number, default: null },
    transactionId: { type: String, default: null },
    providerOrderId: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
    checkoutUrl: { type: String, default: null },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'PENDING' },
    failureReason: { type: String, default: '' },
    collectedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    refunds: [
      {
        _id: false,
        amount: { type: Number, required: true },
        reason: { type: String, default: '' },
        byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: () => new Date() },
        providerRefundId: { type: String, default: null },
      },
    ],
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

paymentSchema.index({ restaurantId: 1, createdAt: -1 });
paymentSchema.index({ providerOrderId: 1 }, { sparse: true });

export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = defineModel('Payment', paymentSchema) as unknown as Model<Payment>;
