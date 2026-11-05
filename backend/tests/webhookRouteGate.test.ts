// The gate is a middleware, so it is tested as one: a request that arrives while the host still holds a
// published default must be turned away before the body parser, before the signature check, and before
// anything could touch a payment or an order. The env module is mocked, which means nothing else may be
// imported from the source tree until it is loaded under the mock.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const accepted = vi.hoisted(() => ({ value: true }));
// A getter, so the flag can move between cases: the module under read uses it per request, the way a
// running server would, rather than once at import time.
vi.mock('../src/config/env', () => ({
  get webhooksAreAccepted() {
    return accepted.value;
  },
}));

const { rejectUntrustedWebhooks } = await import('../src/middleware/webhookTrust');

function run(middleware: ReturnType<typeof rejectUntrustedWebhooks>) {
  let statusCode = 0;
  let body: unknown;
  let passedOn = false;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    passedOn = true;
  };
  middleware({} as Request, res, next);
  return { statusCode, body, passedOn };
}

beforeEach(() => {
  accepted.value = true;
});

describe('the webhook trust gate', () => {
  it('lets a delivery through when this host holds real signing keys', () => {
    accepted.value = true;
    for (const kind of ['Payment', 'Delivery'] as const) {
      const result = run(rejectUntrustedWebhooks(kind));
      expect(result.passedOn).toBe(true);
      expect(result.statusCode).toBe(0);
    }
  });

  it('answers 503 and stops, without calling the rest of the chain', () => {
    accepted.value = false;
    for (const kind of ['Payment', 'Delivery'] as const) {
      const result = run(rejectUntrustedWebhooks(kind));
      expect(result.passedOn).toBe(false);
      expect(result.statusCode).toBe(503);
      expect((result.body as { ok?: boolean }).ok).toBe(false);
      expect(String((result.body as { message?: string }).message)).toContain(kind);
      expect(String((result.body as { message?: string }).message)).toContain('published default');
    }
  });

  it('names the problem without naming a credential', () => {
    accepted.value = false;
    const message = String((run(rejectUntrustedWebhooks('Payment')).body as { message?: string }).message);
    for (const published of ['dev-webhook-secret', 'dev-swiggy-secret', 'dev-zomato-secret', 'dev-website-secret']) {
      expect(message).not.toContain(published);
    }
  });
});
