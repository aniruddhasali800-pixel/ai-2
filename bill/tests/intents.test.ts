import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import {
  cancelByBill,
  claimByToken,
  createBillIntent,
  findIntentByBill,
  intentView,
  settleByStaff,
  transitionPayment,
  TransitionError,
} from '../src/lib/intents';
import { savePayee } from '../src/lib/settings';
import { mirroredStaffId } from '../src/lib/staff';
import { verifyPassword } from '../src/lib/crypto';
import { incomeSummary, defaultRange } from '../src/lib/income';
import { StatusError } from '../src/lib/payments/status';

let ownerId = '';
let billSequence = 0;

async function bill(overrides: Partial<Parameters<typeof createBillIntent>[0]> = {}) {
  billSequence += 1;
  const number = `INV-TEST-${String(billSequence).padStart(4, '0')}`;
  return createBillIntent({
    externalBillId: `bill-${billSequence}`,
    externalBillNumber: number,
    externalRestaurantId: 'restaurant-1',
    externalTableNumber: 'S1',
    customerLabel: `Table S1 · ${number}`,
    amountRupees: 512,
    items: [{ name: 'Butter Chicken', quantity: 1, unitPriceRupees: 320 }, { name: 'Cola', quantity: 2, unitPriceRupees: 90 }],
    ...overrides,
  });
}

async function events(orderId: string) {
  return db.paymentEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
}

before(async () => {
  await db.order.deleteMany({});
  const owner = await db.user.upsert({
    where: { email: 'owner@test.local' },
    create: { email: 'owner@test.local', name: 'Owner', role: 'OWNER', passwordHash: 'x' },
    update: {},
  });
  ownerId = owner.id;
  await savePayee({ vpa: 'demo-cafe@okhdfcbank', payeeName: 'Demo Cafe', businessName: 'Demo Cafe', actorId: ownerId });
});

after(async () => {
  await db.order.deleteMany({});
  await db.$disconnect();
});

test('a bill becomes one payable intent, frozen to the payee of the moment', async () => {
  const created = await bill();
  assert.equal(created.reused, false);
  assert.equal(created.view.amountPaise, 51_200);
  assert.equal(created.view.payeeVpa, 'demo-cafe@okhdfcbank');
  assert.match(created.view.upiUri, /am=512\.00/);
  assert.match(created.view.payUrl, /\/pay\/[\w-]{20,}$/);
  assert.equal(created.view.paymentStatus, 'PENDING');
  assert.equal(created.view.items.length, 2);

  const kinds = (await events(created.view.id)).map((event) => event.type);
  assert.deepEqual(kinds, ['INTENT_CREATED']);
});

test('re-issuing the same bill reuses the request, so a printed QR keeps working', async () => {
  const first = await bill();
  const second = await bill({ externalBillId: first.view.externalBillId as string });
  assert.equal(second.reused, true);
  assert.equal(second.view.id, first.view.id);
  assert.equal(second.view.token, first.view.token, 'a re-issued bill must keep the printed QR working');
});

test('a bill total that moved is synced and recorded, not silently replaced', async () => {
  const first = await bill();
  const again = await bill({ externalBillId: first.view.externalBillId as string, amountRupees: 100 });
  assert.equal(again.view.amountPaise, 10_000);
  const kinds = (await events(again.view.id)).map((event) => event.type);
  assert.ok(kinds.includes('AMOUNT_SYNCED'), kinds.join(','));
});

test('the guest claim raises verification, never payment', async () => {
  const created = await bill();
  const result = await claimByToken(created.view.token);
  assert.equal(result.view.paymentStatus, 'PAYMENT_VERIFICATION_PENDING');
  assert.equal(result.view.status, 'AWAITING_PAYMENT', 'the kitchen must not see unpaid food');

  const kinds = (await events(created.view.id)).map((event) => event.type);
  assert.ok(kinds.includes('CLAIM_RAISED'), kinds.join(','));
  // The configured callback host is unreachable in tests: that must be recorded, not hidden.
  assert.ok(kinds.includes('SIZZLE_SYNC_FAILED'), kinds.join(','));
  assert.equal(result.callback === 'not_applicable', false);
});

test('a claim on a paid bill is refused', async () => {
  const created = await bill();
  await claimByToken(created.view.token);
  await settleByStaff(created.view.id, '123456789012', { id: ownerId, name: 'Owner' });
  await assert.rejects(() => claimByToken(created.view.token), StatusError);
});

test('marking paid without a UTR is refused, and with one it settles', async () => {
  const created = await bill();
  await claimByToken(created.view.token);

  await assert.rejects(
    () => settleByStaff(created.view.id, '   ', { id: ownerId, name: 'Owner' }),
    /reference/i,
  );

  const paid = await settleByStaff(created.view.id, '123456789012', { id: ownerId, name: 'Owner' });
  assert.equal(paid.view.paymentStatus, 'PAID');
  assert.equal(paid.view.status, 'IN_KITCHEN');
  assert.equal(paid.view.utr, '123456789012');
  assert.ok(paid.view.paidAt);
  assert.equal(paid.view.verifiedByName, 'Owner');
});

test('two staff settling at once: only the first write wins', async () => {
  const created = await bill();
  await claimByToken(created.view.token);
  const results = await Promise.allSettled([
    settleByStaff(created.view.id, '11111111111111', { id: ownerId, name: 'Owner' }),
    settleByStaff(created.view.id, '22222222222222', { id: ownerId, name: 'Cashier' }),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one settle should win');
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof TransitionError, String(rejected[0].reason));

  const record = await findIntentByBill(created.view.externalBillId as string);
  const utr = (record?.paymentReference ?? '').slice(0, 4);
  assert.ok(['1111', '2222'].includes(utr), `unexpected surviving UTR ${record?.paymentReference}`);
});

test('a provider actor on a non-settling adapter cannot mark paid', async () => {
  const created = await bill();
  await assert.rejects(
    () =>
      transitionPayment({
        ref: created.view.id,
        to: 'PAID',
        actor: 'PROVIDER',
        reference: 'webhook says so',
      }),
    /cannot confirm/,
  );
});

test('cancelling from the bill id closes the QR, and a finished one is left alone', async () => {
  const created = await bill();
  const cancelled = await cancelByBill(created.view.externalBillId as string, 'Settled by cash at the counter');
  assert.equal(cancelled?.paymentStatus, 'CANCELLED');
  const again = await cancelByBill(created.view.externalBillId as string, 'twice');
  assert.equal(again?.paymentStatus, 'CANCELLED');
});

test('income counts confirmed money only, and shows claims separately', async () => {
  await db.order.deleteMany({});

  const paid = await bill({ amountRupees: 200 });
  await claimByToken(paid.view.token);
  await settleByStaff(paid.view.id, '99999999999999', { id: ownerId, name: 'Owner' });

  const claimed = await bill({ amountRupees: 300 });
  const claim = await claimByToken(claimed.view.token);

  await bill({ amountRupees: 400 });
  const failed = await bill({ amountRupees: 500 });
  await transitionPayment({ ref: failed.view.id, to: 'FAILED', actor: 'STAFF', actorId: ownerId, actorName: 'Owner', reason: 'not in statement' });

  const income = await incomeSummary(defaultRange(2));
  assert.equal(income.collectedPaise, 20_000, 'only the settled bill counts');
  assert.equal(income.count, 1);
  assert.equal(income.awaitingVerification.amountPaise, 30_000);
  assert.equal(income.openRequests.amountPaise, 40_000);
  assert.equal(income.failedOrCancelled.amountPaise, 50_000);
  assert.equal(income.byVerifier[0].name, 'Owner');
  assert.equal(income.days.length, 1);

  const view = await intentView(claim.record);
  assert.equal(view.paymentStatus, 'PAYMENT_VERIFICATION_PENDING');
});

test('money confirmed by someone who signs in over there is still attributable, and they cannot sign in here', async () => {
  const created = await bill({ amountRupees: 640 });
  await claimByToken(created.view.token);

  // Sizzle sends its own user id. It is not a row in this database, and the verifier column
  // points at one — writing it straight through is a foreign key error, i.e. a refused payment.
  const relayed = { role: 'CASHIER' as const, name: 'Priya Cashier', id: '6abcbe42a18db2f5993b7490' };
  const staffId = await mirroredStaffId(relayed);
  const paid = await settleByStaff(created.view.id, '77777777777777', { id: staffId, name: relayed.name });

  assert.equal(paid.view.paymentStatus, 'PAID');
  assert.equal(paid.view.verifiedByName, 'Priya Cashier');

  const mirror = await db.user.findUnique({ where: { id: relayed.id } });
  assert.equal(mirror?.role, 'CASHIER');
  assert.equal(verifyPassword('relay-only', mirror!.passwordHash), false);
  assert.equal((await incomeSummary(defaultRange(2))).byVerifier.some((row) => row.name === 'Priya Cashier'), true);
});
