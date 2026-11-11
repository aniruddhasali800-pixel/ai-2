import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorFromBody, assertAllowed } from '../src/lib/api/actor';
import { roleCan } from '../src/lib/auth/session';
import { ApiError } from '../src/lib/api/handle';

/**
 * The rule the whole integration rests on: the manager sees the queue and the income, and acts
 * on neither; the payee belongs to the owner alone.
 */
test('a manager may read, and nothing else', () => {
  assert.equal(roleCan('MANAGER', 'view'), true);
  assert.equal(roleCan('MANAGER', 'verify'), false);
  assert.equal(roleCan('MANAGER', 'settings'), false);
  assert.doesNotThrow(() => assertAllowed({ role: 'MANAGER', name: 'Manager', id: null }, 'view'));
});

test('a manager cannot settle even when the caller claims they may', () => {
  const actor = actorFromBody({ actor: { role: 'MANAGER', name: 'Manager' } });
  assert.throws(() => assertAllowed(actor, 'verify'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal((error as ApiError).status, 403);
    assert.match((error as ApiError).message, /only read/i);
    return true;
  });
});

test('only the owner moves the payee', () => {
  assert.equal(roleCan('CASHIER', 'settings'), false);
  assert.equal(roleCan('OWNER', 'settings'), true);
  assert.throws(() => assertAllowed({ role: 'CASHIER', name: 'Cashier', id: null }, 'settings'), /payee/i);
});

test('a cashier may settle but may not change the payee', () => {
  assert.equal(roleCan('CASHIER', 'verify'), true);
  assert.equal(roleCan('CASHIER', 'settings'), false);
});

test('a request that names no role is refused rather than assumed', () => {
  for (const body of [{}, { actor: {} }, { actor: { role: 'ROOT' } }, { actor: { role: 'admin' } }]) {
    assert.throws(() => actorFromBody(body as never), /staff role/i);
  }
  assert.throws(() => actorFromBody(null), /staff role/i);
});
