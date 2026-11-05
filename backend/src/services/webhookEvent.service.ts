import { createHash } from 'node:crypto';
import { WebhookEventModel } from '../models';

export interface WebhookDelivery {
  provider: string;
  /** The event identifier the sender put in a header, when it put one in at all. */
  senderEventId?: string;
  /** The same identifier inside the body, which is where the in-house gateway and the bill service put it. */
  bodyEventId?: string;
  event?: string;
  reference?: string;
  restaurantId?: string | null;
}

export interface WebhookClaim {
  eventId: string;
  duplicate: boolean;
}

/**
 * The id this delivery is filed under: the sender's own if it named one, otherwise the digest of the
 * exact bytes that were signed. A digest is enough to stop a replay, because a replay sends those same
 * bytes again — and it tells nobody anything who did not have the body in front of them.
 */
export function webhookEventId(rawBody: string, ...candidates: (string | undefined)[]): string {
  const given = candidates.map((value) => String(value ?? '').trim()).find((value) => value.length > 0);
  if (given) return `event:${given.slice(0, 200)}`;
  return `body:${createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`;
}

/**
 * Takes the delivery for this process before anything it says is acted on.
 *
 * A gateway retries, and a retry that is processed twice would settle a bill twice, so the claim is
 * what turns "believe this event" into "believe this event exactly once". A second claim of the same id
 * reports itself as a duplicate, which lets the caller answer the retry with a 200 — the only answer
 * that makes a gateway stop sending it — without touching a record.
 */
export async function claimWebhookDelivery(delivery: WebhookDelivery, rawBody: string): Promise<WebhookClaim> {
  const provider = String(delivery.provider).toUpperCase();
  const eventId = webhookEventId(rawBody, delivery.senderEventId, delivery.bodyEventId);
  try {
    await WebhookEventModel.create({
      provider,
      eventId,
      event: delivery.event ?? '',
      reference: delivery.reference ?? null,
      restaurantId: delivery.restaurantId ?? null,
      outcome: 'processing',
    });
    return { eventId, duplicate: false };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return { eventId, duplicate: true };
    throw error;
  }
}

/** Writes down what the delivery turned into, so the next reader knows it was handled. */
export async function recordWebhookOutcome(claim: WebhookClaim, provider: string, outcome: string): Promise<void> {
  await WebhookEventModel.updateOne(
    { provider: String(provider).toUpperCase(), eventId: claim.eventId },
    { $set: { outcome } },
  );
}

/**
 * Gives the claim back when the work did not happen.
 *
 * A rejected reference, an unreadable payload or an exception half-way through must not leave a
 * reservation standing: the gateway is going to retry, and refusing that retry is how a genuine payment
 * would never settle at all.
 */
export async function releaseWebhookClaim(claim: WebhookClaim, provider: string): Promise<void> {
  await WebhookEventModel.deleteOne({
    provider: String(provider).toUpperCase(),
    eventId: claim.eventId,
    outcome: 'processing',
  });
}

/**
 * What was delivered about one restaurant, newest first.
 *
 * This is the list an owner argues a dispute from, so it is deliberately narrow: only rows carrying
 * that restaurant's id, and only the fields above — never a signature, never the secret behind it,
 * never the body a partner sent. An event that named no payment at all belongs to no restaurant and
 * therefore appears in nobody's list; it stays in the archive for the operator who runs the host.
 */
export async function listWebhookEventsForRestaurant(restaurantId: string, opts: { provider?: string; limit?: number } = {}) {
  return WebhookEventModel.find({
    restaurantId,
    ...(opts.provider ? { provider: String(opts.provider).toUpperCase() } : {}),
  })
    .sort({ receivedAt: -1 })
    .limit(Math.min(opts.limit ?? 50, 200))
    .select('provider event reference outcome receivedAt')
    .lean();
}
