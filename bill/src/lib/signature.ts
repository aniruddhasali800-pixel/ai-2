import { hmacHex, randomToken, safeEqual } from '@/lib/crypto';

/**
 * One shared secret signs both directions: Sizzle -> this service for intents, and
 * this service -> Sizzle for settlement callbacks. The signature covers the method, the
 * path, the timestamp and the exact body bytes, so a signature for one bill cannot be
 * replayed against another.
 */
const SKEW_SECONDS = 120;

export interface SignedHeaders extends Record<string, string> {
  'content-type': 'application/json';
  'x-pay-key': string;
  'x-pay-timestamp': string;
  'x-pay-nonce': string;
  'x-pay-signature': string;
}

export function canonical(secretless: {
  target: string;
  body: string;
  timestamp: string;
  nonce: string;
}): string {
  return `${secretless.target}.${secretless.timestamp}.${secretless.nonce}.${secretless.body}`;
}

export function signBody(secret: string, body: string, target = ''): SignedHeaders {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomToken(12);
  return {
    'content-type': 'application/json',
    'x-pay-key': process.env.PAY_SERVICE_KEY ?? 'sizzle',
    'x-pay-timestamp': timestamp,
    'x-pay-nonce': nonce,
    'x-pay-signature': hmacHex(secret, canonical({ target, body, timestamp, nonce })),
  };
}

export interface VerifyInput {
  secret?: string | null;
  target: string;
  rawBody: string;
  signature?: string | null;
  timestamp?: string | null;
  nonce?: string | null;
  nowSeconds?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifySignature(input: VerifyInput): VerifyResult {
  const { secret, target, rawBody, signature, timestamp, nonce } = input;
  if (!secret) return { ok: false, reason: 'This service has no shared secret configured' };
  if (!signature) return { ok: false, reason: 'Missing signature header' };
  if (!timestamp || !nonce) return { ok: false, reason: 'Missing timestamp or nonce header' };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const issued = Number(timestamp);
  if (!Number.isFinite(issued)) return { ok: false, reason: 'Malformed timestamp' };
  if (Math.abs(now - issued) > SKEW_SECONDS) return { ok: false, reason: 'Signature has expired' };

  const expected = hmacHex(secret, canonical({ target, body: rawBody, timestamp, nonce }));
  if (!safeEqual(expected, signature)) return { ok: false, reason: 'Signature verification failed' };
  return { ok: true };
}

/** What a Request carries, in the shape verifySignature wants. */
export function requestSignature(req: Request): { target: string; signature?: string | null; timestamp?: string | null; nonce?: string | null } {
  const url = new URL(req.url);
  return {
    target: `${req.method.toUpperCase()} ${url.pathname}`,
    signature: req.headers.get('x-pay-signature'),
    timestamp: req.headers.get('x-pay-timestamp'),
    nonce: req.headers.get('x-pay-nonce'),
  };
}
