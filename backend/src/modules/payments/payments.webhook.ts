import { gatewayFor } from '../../integrations/payments';
import {
  markPaymentFailed,
  markPaymentSucceeded,
  markPaymentVerificationPending,
} from '../../services/billing.service';

export interface WebhookResult {
  ok: boolean;
  status?: number;
  message: string;
}

interface GatewayPayload {
  event?: string;
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
 * Signature is verified against the raw request body before anything is read.
 */
export async function handleGatewayWebhook(provider: string, rawBody: string, signature: string): Promise<WebhookResult> {
  const gateway = gatewayFor(provider.toUpperCase());
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
    await markPaymentFailed({
      providerOrderId: reference,
      reason: entity.error_description ?? body.reason,
    });
    return { ok: true, message: 'Failure recorded' };
  }

  if (event === 'refund.processed' || event === 'refund.created') {
    return { ok: true, message: 'Refund acknowledged' };
  }

  return { ok: true, message: `Ignored event "${event || 'unknown'}"` };
}
