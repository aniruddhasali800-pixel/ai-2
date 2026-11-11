import { env } from '../config/env';
import { hmacHex, randomToken } from '../utils/tokens';
import { ApiError } from '../utils/httpError';
import { handleGatewayWebhook } from '../modules/payments/payments.webhook';

/**
 * Sandbox settlement, shared by the staff "simulate" button and the guest app's
 * checkout page. It cannot shortcut anything: the capture is expressed as a gateway
 * webhook body, HMAC-signed with the same secret, and pushed through the one code
 * path that is allowed to mark money as received. Real gateway payments never qualify —
 * their provider is RAZORPAY, so this throws long before a signature is built.
 */
export async function captureMockPayment(opts: {
  providerOrderId: string;
  provider: string;
  outcome?: 'SUCCESS' | 'FAILURE';
  reason?: string;
}) {
  if (opts.provider !== 'MOCK') throw ApiError.badRequest('Only sandbox payments can be captured here');

  const payload =
    opts.outcome === 'FAILURE'
      ? {
          event: 'payment.failed',
          payload: {
            payment: { entity: { order_id: opts.providerOrderId, error_description: opts.reason ?? 'Payment declined by bank' } },
          },
        }
      : {
          event: 'payment.captured',
          payload: {
            payment: { entity: { id: `mockpay_${randomToken(8)}`, order_id: opts.providerOrderId, status: 'captured' } },
          },
        };

  const raw = JSON.stringify(payload);
  const result = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
  if (!result.ok) throw new ApiError(result.status ?? 400, result.message);
  return result;
}
