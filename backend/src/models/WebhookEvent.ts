import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';

/**
 * One line per webhook delivery this service chose to believe.
 *
 * A gateway retries, and a retry that is processed twice settles a bill twice, so the identifier the
 * sender promised was unique is written down before any money or ticket moves. Where a sender gives no
 * identifier at all, the digest of the exact bytes stands in: two deliveries of an identical body are
 * the same event by definition, and a body that differs is a different claim.
 *
 * Nothing here lets a stranger read a restaurant's ledger. The signature, the secret behind it and any
 * customer name, phone or address are all left out — only what happened, when, and to which reference.
 */
const webhookEventSchema = new Schema(
  {
    provider: { type: String, required: true, uppercase: true, trim: true },
    /** Either the sender's own event id, or `body:<digest>` when the sender sent none. */
    eventId: { type: String, required: true },
    event: { type: String, default: '' },
    /** The payment or partner-order reference the event spoke about. */
    reference: { type: String, default: null },
    restaurantId: { type: Schema.Types.ObjectId, default: null },
    /** `accepted` once the business action ran, or `rejected` when nothing matched. */
    outcome: { type: String, default: 'processing' },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// A retry carries the sender's id, so the pair of them is what may never appear twice.
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export type WebhookEvent = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEventModel = defineModel('WebhookEvent', webhookEventSchema) as unknown as Model<WebhookEvent>;
