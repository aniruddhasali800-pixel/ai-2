import { hmacHex } from './crypto';
import type { PaymentStatus } from './payments/status';

/**
 * Settlement is confirmed in this service, but Sizzle owns the bill, the table and the
 * kitchen — so the truth is pushed to Sizzle's payment webhook, signed the way Sizzle
 * verifies every gateway: HMAC-SHA256 over the exact request body.
 */
const PATH = '/api/payments/webhook/UPI_DIRECT';

export interface CallbackPayload {
  event: 'payment.captured' | 'payment.failed' | 'payment.verification_pending';
  providerOrderId: string;
  providerPaymentId: string;
  amountPaise: number;
  utr?: string | null;
  reason?: string | null;
  billNumber?: string | null;
}

export interface CallbackResult {
  ok: boolean;
  status: number | 'unconfigured' | 'network';
  message: string;
}

function buildBody(payload: CallbackPayload): string {
  return JSON.stringify({
    event: payload.event,
    order_id: payload.providerOrderId,
    payment_id: payload.providerPaymentId,
    // Flat copy as well: the Sizzle handler reads either shape.
    utr: payload.utr ?? null,
    amount_paise: payload.amountPaise,
    bill_number: payload.billNumber ?? null,
    payload: {
      payment: {
        entity: {
          id: payload.providerPaymentId,
          order_id: payload.providerOrderId,
          amount: payload.amountPaise,
          status: payload.event === 'payment.failed' ? 'failed' : 'captured',
          method: 'upi',
          error_description: payload.reason ?? undefined,
        },
      },
    },
  });
}

export async function notifySizzle(payload: CallbackPayload): Promise<CallbackResult> {
  const base = process.env.SIZZLE_API_BASE_URL?.replace(/\/$/, '');
  const secret = process.env.SIZZLE_SHARED_SECRET;
  if (!base || !secret) return { ok: false, status: 'unconfigured', message: 'Sizzle callback is not configured' };

  const rawBody = buildBody(payload);
  try {
    const res = await fetch(`${base}${PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-payment-signature': hmacHex(secret, rawBody),
        'x-pay-key': process.env.PAY_SERVICE_KEY ?? 'sizzle-pay',
      },
      body: rawBody,
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return {
      ok: res.ok && body.ok === true,
      status: res.status,
      message: body.message ?? `Sizzle replied ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'network',
      message: error instanceof Error ? error.message : 'Sizzle callback failed',
    };
  }
}

/** A PAID row here is a claim about money; Sizzle is told, and it decides the rest. */
export function statusToEvent(status: PaymentStatus): CallbackPayload['event'] | null {
  if (status === 'PAYMENT_VERIFICATION_PENDING') return 'payment.verification_pending';
  if (status === 'PAID') return 'payment.captured';
  if (status === 'FAILED') return 'payment.failed';
  return null;
}
