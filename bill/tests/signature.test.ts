import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { canonical, signBody, verifySignature } from '../src/lib/signature';

const SECRET = 'unit-test-secret';
const BODY = '{"externalBillId":"abc","amountRupees":512.5}';
const TARGET = 'POST /api/v1/intents';

function sign(target: string, body: string, timestamp: string, nonce: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(canonical({ target, body, timestamp, nonce })).digest('hex');
}

const now = (): string => String(Math.floor(Date.now() / 1000));

test('a correctly signed request is accepted', () => {
  const timestamp = now();
  assert.deepEqual(
    verifySignature({ secret: SECRET, target: TARGET, rawBody: BODY, signature: sign(TARGET, BODY, timestamp, 'abc'), timestamp, nonce: 'abc' }),
    { ok: true },
  );
});

test('an edited amount is rejected', () => {
  const timestamp = now();
  const signature = sign(TARGET, BODY, timestamp, 'abc');
  const result = verifySignature({
    secret: SECRET,
    target: TARGET,
    rawBody: BODY.replace('512.5', '1.00'),
    signature,
    timestamp,
    nonce: 'abc',
  });
  assert.equal(result.ok, false);
});

test('a signature for one path cannot be replayed on another bill', () => {
  const timestamp = now();
  const signature = sign(TARGET, BODY, timestamp, 'abc');
  const result = verifySignature({
    secret: SECRET,
    target: 'POST /api/v1/intents/other/settle',
    rawBody: BODY,
    signature,
    timestamp,
    nonce: 'abc',
  });
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /failed/);
});

test('an old signature expires instead of replaying forever', () => {
  const timestamp = String(Math.floor(Date.now() / 1000) - 600);
  const result = verifySignature({
    secret: SECRET,
    target: TARGET,
    rawBody: BODY,
    signature: sign(TARGET, BODY, timestamp, 'abc'),
    timestamp,
    nonce: 'abc',
  });
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /expired/i);
});

test('missing pieces are named, not guessed at', () => {
  const timestamp = now();
  const base = {
    secret: SECRET,
    target: TARGET,
    rawBody: BODY,
    timestamp,
    nonce: 'abc',
    signature: sign(TARGET, BODY, timestamp, 'abc'),
  };
  assert.match((verifySignature({ ...base, signature: null }) as { reason: string }).reason, /signature header/i);
  assert.match((verifySignature({ ...base, timestamp: null }) as { reason: string }).reason, /timestamp/i);
  assert.match((verifySignature({ ...base, nonce: null }) as { reason: string }).reason, /nonce/i);
  assert.match((verifySignature({ ...base, secret: null }) as { reason: string }).reason, /shared secret/i);
});

test('what signBody produces is what the verifier expects', () => {
  const headers = signBody(SECRET, BODY, TARGET);
  const result = verifySignature({
    secret: SECRET,
    target: TARGET,
    rawBody: BODY,
    signature: headers['x-pay-signature'],
    timestamp: headers['x-pay-timestamp'],
    nonce: headers['x-pay-nonce'],
  });
  assert.deepEqual(result, { ok: true });
});
