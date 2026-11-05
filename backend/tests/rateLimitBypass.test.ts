// The sign-in rate limit is the only thing between a stranger and an unhurried guess at staff
// passwords, and until today a header anybody could type switched it off. These cases hold the
// replacement to one standard: nothing is skipped unless the caller holds the token the host set.
import { afterEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { isTrustedLoadRun } from '../src/middleware/rateLimit';
import { env } from '../src/config/env';

const held = env.LOAD_TEST_TOKEN;

afterEach(() => {
  env.LOAD_TEST_TOKEN = held;
});

/** A request carrying only what a caller can choose to carry. */
const asking = (header?: string): Request =>
  ({ headers: header === undefined ? {} : { 'x-load-test-auth': header } }) as unknown as Request;

describe('who may pass the sign-in rate limit', () => {
  it('skips nothing at all while the host holds no harness token', () => {
    env.LOAD_TEST_TOKEN = '';
    // The exact value the old harness sent, which used to be enough on its own.
    expect(isTrustedLoadRun(asking('1'))).toBe(false);
    expect(isTrustedLoadRun(asking())).toBe(false);
  });

  it('trusts a run that presents the token, and nothing that presents a guess', () => {
    env.LOAD_TEST_TOKEN = 'a-token-only-the-load-harness-has';
    expect(isTrustedLoadRun(asking('a-token-only-the-load-harness-has'))).toBe(true);
    expect(isTrustedLoadRun(asking('1'))).toBe(false);
    expect(isTrustedLoadRun(asking('a-token-only-the-load-harness-has-extended'))).toBe(false);
    // A prefix would be the giveaway a non-constant-time compare turns into a search.
    expect(isTrustedLoadRun(asking('a-token'))).toBe(false);
    expect(isTrustedLoadRun(asking())).toBe(false);
  });

  it('refuses a header the framework resolved to an array of values', () => {
    env.LOAD_TEST_TOKEN = 'a-token-only-the-load-harness-has';
    const duplicated = { headers: { 'x-load-test-auth': ['a-token-only-the-load-harness-has', 'x'] } } as unknown as Request;
    expect(isTrustedLoadRun(duplicated)).toBe(false);
  });
});
