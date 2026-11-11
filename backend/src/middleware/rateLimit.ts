import rateLimit from 'express-rate-limit';

const json = (message: string) => ({ error: { code: 'RATE_LIMITED', message } });

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many sign-in attempts. Please wait a few minutes.'),
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
