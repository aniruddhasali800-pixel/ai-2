import { env } from '../config/env';
import { hmacHex, randomToken, safeEqual } from '../utils/tokens';
import { billServiceConfig, billServiceSecret, createBillIntent } from './billService';
import type { PaymentMethod } from '../types/constants';

export interface PaymentIntent {
  providerOrderId: string;
  checkoutUrl: string | null;
  meta?: Record<string, unknown>;
}

export interface PaymentGateway {
  id: string;
  createIntent(opts: {
    amount: number;
    currency: string;
    reference: string;
    method: PaymentMethod;
    notes?: string;
    /** Sizzle's own bill id — what the bill service keys its request on. */
    externalId?: string;
    customerLabel?: string;
    tableNumber?: string;
  }): Promise<PaymentIntent>;
  refund(opts: { providerPaymentId: string; amount: number; reason?: string }): Promise<{ providerRefundId: string }>;
  verifyWebhook(rawBody: string, signature: string): boolean;
}

/** Development gateway: intents are created instantly and webhooks are HMAC-signed. */
const mockGateway: PaymentGateway = {
  id: 'MOCK',
  async createIntent({ amount, reference, method }) {
    const providerOrderId = `mock_${randomToken(10)}`;
    return {
      providerOrderId,
      checkoutUrl: `${env.PUBLIC_BASE_URL}/pay/mock?ref=${encodeURIComponent(reference)}&amount=${amount}&method=${method}`,
      meta: { method, sandbox: true },
    };
  },
  async refund({ amount }) {
    return { providerRefundId: `mockrf_${randomToken(8)}_${Math.round(amount * 100)}` };
  },
  verifyWebhook(rawBody, signature) {
    return hmacHex(env.PAYMENT_WEBHOOK_SECRET, rawBody) === signature;
  },
};

/**
 * Razorpay adapter — activates automatically when API keys are present.
 * Webhook verification follows Razorpay's documented HMAC-SHA256 scheme.
 */
const razorpayGateway: PaymentGateway = {
  id: 'RAZORPAY',
  async createIntent({ amount, currency, reference, notes }) {
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(amount * 100),
        currency,
        reference_id: reference,
        description: notes ?? reference,
        callback_url: `${env.PUBLIC_BASE_URL}/pay/return?ref=${encodeURIComponent(reference)}`,
        callback_method: 'get',
      }),
    });
    if (!res.ok) throw new Error(`Razorpay intent failed: ${res.status}`);
    const body = (await res.json()) as { id: string; short_url?: string };
    return { providerOrderId: body.id, checkoutUrl: body.short_url ?? null, meta: { gateway: 'razorpay' } };
  },
  async refund({ providerPaymentId, amount }) {
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/payments/${providerPaymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(amount * 100) }),
    });
    if (!res.ok) throw new Error(`Razorpay refund failed: ${res.status}`);
    const body = (await res.json()) as { id: string };
    return { providerRefundId: body.id };
  },
  verifyWebhook(rawBody, signature) {
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return false;
    return hmacHex(secret, rawBody) === signature;
  },
};

/**
 * Direct UPI collection, run by the bill service. There is no gateway to ask whether the money
 * arrived, so this adapter can never settle anything on its own word: a claim raises
 * `payment.verification_pending`, and only a person reading their own statement sends
 * `payment.captured` — which is still verified here by signature before it is believed.
 */
const upiDirectGateway: PaymentGateway = {
  id: 'UPI_DIRECT',
  async createIntent({ amount, currency, reference, externalId, customerLabel, tableNumber }) {
    const config = billServiceConfig();
    if (!config) throw new Error('The bill service is not configured, so no UPI request can be raised');
    if (currency !== 'INR') throw new Error(`Direct UPI only collects INR, not ${currency}`);
    if (!externalId) throw new Error('A UPI request needs the bill it belongs to');

    const { intent, reused } = await createBillIntent({
      externalBillId: externalId,
      externalBillNumber: reference,
      externalTableNumber: tableNumber ?? null,
      customerLabel: customerLabel ?? reference,
      amountRupees: amount,
    });
    return {
      providerOrderId: intent.id,
      checkoutUrl: intent.payUrl,
      meta: { token: intent.token, reused, payeeMasked: intent.payeeVpaMasked, amountPaise: intent.amountPaise },
    };
  },
  async refund() {
    // Money sent to a UPI handle is given back from that handle's own app, by the payee. Nothing
    // here can do it, so no fake reference is invented — the ledger records the refund itself.
    throw new Error("Direct UPI refunds are sent from the payee's own UPI app");
  },
  verifyWebhook(rawBody, signature) {
    const secret = billServiceSecret();
    if (!secret || !signature) return false;
    return safeEqual(hmacHex(secret, rawBody), signature);
  },
};

export function gatewayFor(provider: string): PaymentGateway | null {
  // Present whenever the secret is: the bill's callbacks must verify even if this process would
  // not call back out to it. Raising a request checks the full pairing itself.
  if (provider === 'UPI_DIRECT') return billServiceSecret() ? upiDirectGateway : null;
  if (provider === 'RAZORPAY' && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) return razorpayGateway;
  if (provider === 'MOCK' || provider === 'RAZORPAY') return mockGateway;
  return null;
}

export function onlineGateway(): PaymentGateway {
  // Real collection beats the sandbox: when the bill service is paired, every online payment
  // is a genuine UPI request rather than a mock intent that needs a "simulate" button.
  if (billServiceConfig()) return upiDirectGateway;
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) return razorpayGateway;
  return mockGateway;
}
