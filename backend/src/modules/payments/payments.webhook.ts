import { gatewayFor } from '../../integrations/payments';
import {
  markPaymentFailed,
  markPaymentSucceeded,
  markPaymentVerificationPending,
} from '../../services/billing.service';
import { claimWebhookDelivery, recordWebhookOutcome, releaseWebhookClaim } from '../../services/webhookEvent.service';
import { PaymentModel } from '../../models';

export interface WebhookResult {
  ok: boolean;
  status?: number;
  message: string;
}

interface GatewayPayload {
  event?: string;
  event_id?: string;
  id?: string;
  payload?: {
    payment?: {
      entity?: { id?: string; order_id?: string; amount?: number; error_description?: string };
    };
    payment_link?: { entity?: { id?: string } };
    refund?: { entity?: { id?: string; payment_id?: string } };
  };
  order_id?: string;
  payment_link_id?: string;
  payment_id?: string;
  /** The bill service sends its own reference alongside the gateway-shaped one. */
  utr?: string | null;
  amount_paise?: number;
  bill_number?: string | null;
  reason?: string;
}

/**
 * The single code path that may ever mark a payment as settled.
 *
 * The order of the three gates below is the whole security property of this function: the signature is
 * checked against the exact bytes the sender sent, then the event is claimed so a retry or a replay of
 * those same bytes cannot be acted on twice, and only then does anything read or write a bill. A message
 * that fails either gate changes nothing, whatever it claims to be about.
 */
export async function handleGatewayWebhook(
  provider: string,
  rawBody: string,
  signature: string,
  senderEventId = '',
): Promise<WebhookResult> {
  const name = provider.toUpperCase();
  const gateway = gatewayFor(name);
  if (!gateway) return { ok: false, status: 404, message: 'Unknown payment provider' };
  if (!signature) return { ok: false, status: 401, message: 'Missing signature header' };
  if (!gateway.verifyWebhook(rawBody, signature)) {
    return { ok: false, status: 401, message: 'Signature verification failed' };
  }

  let body: GatewayPayload;
  try {
    body = JSON.parse(rawBody) as GatewayPayload;
  } catch {
    return { ok: false, status: 400, message: 'Malformed webhook payload' };
  }

  const event = String(body.event ?? '');
  const entity = body.payload?.payment?.entity ?? {};
  const reference =
    entity.order_id ?? body.payload?.payment_link?.entity?.id ?? body.order_id ?? body.payment_link_id ?? undefined;

  // Which restaurant this event is about, when the reference already belongs to one. An event that names
  // no payment the tenant owns belongs to nobody, so it stays out of every tenant's review list — and a
  // delivery the app could not act on gives its claim back, so the gateway's retry is still believed.
  const known = reference
    ? await PaymentModel.findOne({ providerOrderId: reference }).select('restaurantId').lean()
    : null;
  const restaurantId = known?.restaurantId ? String(known.restaurantId) : null;

  const claim = await claimWebhookDelivery(
    {
      provider: name,
      senderEventId,
      bodyEventId: body.event_id ?? body.id,
      event,
      reference,
      restaurantId,
    },
    rawBody,
  );
  if (claim.duplicate) {
    // A retry deserves a 200, or the gateway keeps sending it. Nothing here was changed a second time.
    return { ok: true, status: 200, message: 'Duplicate delivery ignored' };
  }

  const result = await applyPaymentEvent(event, reference, entity, body);
  if (result.ok) await recordWebhookOutcome(claim, name, `accepted:${result.status ?? 200}`);
  else await releaseWebhookClaim(claim, name);
  return result;
}

/** The business decision, reached only once the delivery is signed and claimed. */
async function applyPaymentEvent(
  event: string,
  reference: string | undefined,
  entity: { id?: string; error_description?: string },
  body: GatewayPayload,
): Promise<WebhookResult> {
  const utr = typeof body.utr === 'string' && body.utr ? body.utr : undefined;

  if (event === 'payment.verification_pending') {
    if (!reference) return { ok: false, status: 400, message: 'Claim has no payment reference' };
    const result = await markPaymentVerificationPending({ providerOrderId: reference });
    return { ok: result.ok, status: result.ok ? 200 : 404, message: result.message ?? 'Claim recorded' };
  }

  if (event === 'payment.captured' || event === 'payment_link.paid' || event === 'payment.succeeded') {
    if (!reference) return { ok: false, status: 400, message: 'Webhook has no payment reference' };
    const result = await markPaymentSucceeded({
      providerOrderId: reference,
      providerPaymentId: entity.id ?? body.payment_id,
      utr,
    });
    return { ok: result.ok, status: result.ok ? 200 : 404, message: result.message ?? 'Payment settled' };
  }

  if (event === 'payment.failed') {
    if (!reference) return { ok: false, status: 400, message: 'Failure has no payment reference' };
    await markPaymentFailed({ providerOrderId: reference, reason: entity.error_description ?? body.reason });
    return { ok: true, message: 'Failure recorded' };
  }

  if (event === 'refund.processed' || event === 'refund.created') {
    return { ok: true, message: 'Refund acknowledged' };
  }

  return { ok: true, message: `Ignored event "${event || 'unknown'}"` };
}
