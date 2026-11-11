import { Router, raw } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { handleGatewayWebhook } from './payments.webhook';

/**
 * Mounted before the JSON body parser so the raw payload bytes stay intact
 * for HMAC verification. No auth — the signature is the authentication.
 */
export const paymentWebhookRouter = Router();

paymentWebhookRouter.post(
  '/:provider',
  // The signature is an HMAC over the exact bytes the gateway sent. Re-serialising a parsed body
  // would produce different bytes, so a real signature could never match: keep the raw buffer.
  raw({ type: () => true, limit: '1mb' }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ ok: false, message: 'Webhook body must arrive as raw bytes' });
      return;
    }
    const rawBody = req.body.toString('utf8');
    const signature = String(
      req.headers['x-razorpay-signature'] ?? req.headers['x-signature'] ?? req.headers['x-payment-signature'] ?? '',
    );
    const result = await handleGatewayWebhook(req.params.provider, rawBody, signature);
    res.status(result.ok ? 200 : result.status ?? 400).json({ ok: result.ok, message: result.message });
  }),
);
