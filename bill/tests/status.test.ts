import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, allowedTransitions, canTransition, isTerminal, type PaymentStatus } from '../src/lib/payments/status';

test('no customer action can produce PAID', () => {
  for (const from of ['PENDING', 'PAYMENT_VERIFICATION_PENDING'] as PaymentStatus[]) {
    assert.equal(canTransition(from, 'PAID', 'CUSTOMER'), false, `CUSTOMER must not settle from ${from}`);
  }
  assert.throws(
    () => assertTransition('PAYMENT_VERIFICATION_PENDING', 'PAID', 'CUSTOMER', '123456789012'),
    /not allowed/,
  );
});

test('a claim only ever reaches verification pending', () => {
  assert.equal(canTransition('PENDING', 'PAYMENT_VERIFICATION_PENDING', 'CUSTOMER'), true);
  assert.equal(canTransition('PAYMENT_VERIFICATION_PENDING', 'PAYMENT_VERIFICATION_PENDING', 'CUSTOMER'), true);
  assert.equal(canTransition('CANCELLED', 'PAYMENT_VERIFICATION_PENDING', 'CUSTOMER'), false);
});

test('PAID needs a bank reference, whoever says it', () => {
  assert.throws(() => assertTransition('PENDING', 'PAID', 'STAFF', ''), /UTR|reference/i);
  assert.throws(() => assertTransition('PENDING', 'PAID', 'STAFF', '   '), /UTR|reference/i);
  assert.doesNotThrow(() => assertTransition('PENDING', 'PAID', 'STAFF', '123456789012'));
});

test('settled states are terminal in every direction', () => {
  for (const status of ['PAID', 'FAILED', 'CANCELLED'] as PaymentStatus[]) {
    assert.equal(isTerminal(status), true, status);
    assert.deepEqual(allowedTransitions(status), []);
    for (const to of ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'PAYMENT_VERIFICATION_PENDING'] as PaymentStatus[]) {
      assert.equal(canTransition(status, to, 'STAFF'), false, `${status} -> ${to}`);
    }
  }
});

test('a waiter cannot cancel what staff has already claimed', () => {
  // Only STAFF may cancel a claim, and no actor may cancel a PAID payment.
  assert.equal(canTransition('PAYMENT_VERIFICATION_PENDING', 'CANCELLED', 'STAFF'), true);
  assert.equal(canTransition('PAID', 'CANCELLED', 'STAFF'), false);
});
