import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';
import { safeEqual } from '../utils/tokens';

const json = (message: string) => ({ error: { code: 'RATE_LIMITED', message } });

/**
 * Whether this request is the load harness rather than a stranger.
 *
 * A header anyone can type is not an identity: as long as `x-load-test-auth: 1` was enough, every
 * sign-in limit in this service was public documentation for how to skip it, and a credential-stuffing
 * run needed nothing but a browser extension. The harness now has to hold the token the host sets, and
 * with no token set — the default, and the only safe state for a production host — nothing is ever
 * skipped. The value is compared in constant time because it is a secret with a guessable shape.
 */
export function isTrustedLoadRun(req: Request): boolean {
  const token = env.LOAD_TEST_TOKEN;
  if (!token) return false;
  const presented = req.headers['x-load-test-auth'];
  return typeof presented === 'string' && safeEqual(presented, token);
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many sign-in attempts. Please wait a few minutes.'),
  skip: isTrustedLoadRun,
});

export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many requests. Please slow down.'),
});

export const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many requests. Please wait a moment.'),
});

/**
 * A webhook is authenticated by its signature, not by a session, so it is the one route a stranger can
 * address without a credential at all. Real gateways retry a handful of events a minute; this leaves
 * room for a busy service and denies anybody the throughput to brute-force a signature or to pile
 * rejected requests into the log.
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many webhook deliveries. Please slow down.'),
});
