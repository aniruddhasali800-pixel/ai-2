// The cases the incident checklist asked for that the other webhook files do not reach: a secret that is
// blank rather than wrong, two deliveries that arrive at the same moment, one tenant reading another's
// delivery history, and the state transitions a forged or reordered event would have to survive.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { connectTestDb, disconnectTestDb, makeDiner, resetDb } from './helpers';
import { env } from '../src/config/env';
import { hmacHex } from '../src/utils/tokens';
import { handleGatewayWebhook } from '../src/modules/payments/payments.webhook';
import { handleDeliveryWebhook } from '../src/modules/integrations/delivery.webhook';
import { createBill, markPaymentFailed, markPaymentSucceeded, startOnlinePayment } from '../src/services/billing.service';
import { createOrder } from '../src/services/order.service';
import { openSession } from '../src/services/table.service';
import { BillModel, OrderModel, PaymentModel, WebhookEventModel } from '../src/models';
import { listWebhookEventsForRestaurant } from '../src/services/webhookEvent.service';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

const cashier = (id: string) => ({ userId: id, role: 'CASHIER' as const, name: 'Rohit' });

async function pendingPayment(actorId: string) {
  const diner = await makeDiner();
  const session = await openSession({
    restaurantId: diner.restaurantId,
    tableId: diner.largeTableId,
    guestCount: 2,
    customerName: 'Meera Joshi',
    via: 'STAFF',
  });
  await createOrder({
    restaurantId: diner.restaurantId,
    source: 'DINE_IN_QR',
    tableId: diner.largeTableId,
    tableSessionId: String(session._id),
    items: [{ productId: diner.colaProductId, qty: 2 }],
  });
  const bill = await createBill({
    restaurantId: diner.restaurantId,
    actor: cashier(diner.cashierId),
    sessionId: String(session._id),
  });
  const payment = await startOnlinePayment({
    restaurantId: diner.restaurantId,
    billId: String(bill._id),
    actor: cashier(actorId),
    method: 'UPI',
  });
  return { diner, bill, payment };
}

const captureBody = (reference: string, paymentId = 'pay_x') =>
  JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: reference } } } });

describe('a secret that is blank rather than wrong', () => {
  it('rejects a payment delivery signed with an empty key', async () => {
    const { payment } = await pendingPayment('000000000000000000000021');
    const raw = captureBody(payment.providerOrderId ?? '');
    // An HMAC under an empty key is a value anybody can compute, so a host that cleared its secret has to
    // refuse deliveries rather than accept forgeries. The signature below is correct under ''.
    const forged = hmacHex('', raw);
    const previous = env.PAYMENT_WEBHOOK_SECRET;
    env.PAYMENT_WEBHOOK_SECRET = '';
    try {
      expect(await handleGatewayWebhook('MOCK', raw, forged)).toMatchObject({ ok: false, status: 401 });
      expect(await handleGatewayWebhook('MOCK', raw, hmacHex(previous, raw))).toMatchObject({ ok: false, status: 401 });
      expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('PENDING');
    } finally {
      env.PAYMENT_WEBHOOK_SECRET = previous;
    }
    // With the real key back in place the same delivery settles, so the refusal was about the key.
    expect((await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw))).ok).toBe(true);
  });

  it('rejects a delivery partner order signed with an empty key', async () => {
    const diner = await makeDiner();
    const raw = JSON.stringify({
      event: 'order_placed',
      order: {
        order_id: 'blank-key-check',
        customer: { name: 'Ritika Sharma', phone: '9812345670' },
        items: [{ name: 'Butter Chicken', price: 340, quantity: 1 }],
      },
    });
    const previous = env.SWIGGY_WEBHOOK_SECRET;
    env.SWIGGY_WEBHOOK_SECRET = '';
    try {
      const result = await handleDeliveryWebhook({
        provider: 'swiggy',
        rawBody: raw,
        signature: hmacHex('', raw),
        restaurantId: diner.restaurantId,
      });
      expect(result).toMatchObject({ ok: false, status: 401 });
      expect(await OrderModel.countDocuments({ restaurantId: diner.restaurantId, source: 'SWIGGY' })).toBe(0);
    } finally {
      env.SWIGGY_WEBHOOK_SECRET = previous;
    }
  });

  it('rejects a Razorpay delivery while no Razorpay webhook secret is set', async () => {
    const previous = env.RAZORPAY_WEBHOOK_SECRET;
    delete env.RAZORPAY_WEBHOOK_SECRET;
    try {
      const raw = captureBody('order-not-mine');
      expect(await handleGatewayWebhook('RAZORPAY', raw, hmacHex('', raw))).toMatchObject({ ok: false, status: 401 });
    } finally {
      if (previous !== undefined) env.RAZORPAY_WEBHOOK_SECRET = previous;
    }
  });
});

describe('two deliveries of one event arriving together', () => {
  it('settles the bill once, whichever one gets there first', async () => {
    const { bill, payment } = await pendingPayment('000000000000000000000022');
    const raw = captureBody(payment.providerOrderId ?? '');
    const signature = hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw);

    const both = await Promise.all([
      handleGatewayWebhook('MOCK', raw, signature),
      handleGatewayWebhook('MOCK', raw, signature),
    ]);

    const settled = await PaymentModel.findById(payment._id).lean();
    expect(settled?.status).toBe('SUCCEEDED');
    expect(await BillModel.countDocuments({ _id: bill._id, status: 'PAID' })).toBe(1);
    // Exactly one of the two wrote the ledger row: the other found it already there.
    expect(await WebhookEventModel.countDocuments({ provider: 'MOCK', reference: payment.providerOrderId })).toBe(1);
    // Both are answered, and neither reports a failure — a gateway that sees an error keeps retrying.
    expect(both.every((result) => result.ok)).toBe(true);
  });

  it('ingests one partner order once when the same delivery races itself', async () => {
    const diner = await makeDiner();
    const raw = JSON.stringify({
      event: 'order_placed',
      order: {
        order_id: 'race-1',
        customer: { name: 'Ritika Sharma', phone: '9812345670' },
        items: [{ name: 'Butter Chicken', price: 340, quantity: 1 }],
      },
    });
    const signature = hmacHex(env.SWIGGY_WEBHOOK_SECRET, raw);
    const deliver = () =>
      handleDeliveryWebhook({ provider: 'swiggy', rawBody: raw, signature, restaurantId: diner.restaurantId });

    const results = await Promise.all([deliver(), deliver(), deliver()]);

    expect(await OrderModel.countDocuments({ restaurantId: diner.restaurantId, externalOrderId: 'race-1' })).toBe(1);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(new Set(results.map((result) => String(result.orderId))).size).toBe(1);
  });
});

describe('one tenant reading another tenant', () => {
  it('sees only its own webhook history', async () => {
    const a = await makeDiner();
    const b = await makeDiner();

    const orderFor = (externalId: string) =>
      JSON.stringify({
        event: 'order_placed',
        order: {
          order_id: externalId,
          customer: { name: 'Ritika Sharma', phone: '9812345670' },
          items: [{ name: 'Butter Chicken', price: 340, quantity: 1 }],
        },
      });

    for (const [restaurantId, externalId] of [
      [a.restaurantId, 'tenant-a-1'],
      [b.restaurantId, 'tenant-b-1'],
      [b.restaurantId, 'tenant-b-2'],
    ] as const) {
      const raw = orderFor(externalId);
      const result = await handleDeliveryWebhook({
        provider: 'swiggy',
        rawBody: raw,
        signature: hmacHex(env.SWIGGY_WEBHOOK_SECRET, raw),
        restaurantId,
      });
      expect(result.ok).toBe(true);
    }

    const listA = await listWebhookEventsForRestaurant(a.restaurantId);
    const listB = await listWebhookEventsForRestaurant(b.restaurantId);
    expect(listA.map((row) => row.reference)).toEqual(['tenant-a-1']);
    expect(listB.map((row) => row.reference).sort()).toEqual(['tenant-b-1', 'tenant-b-2']);
    expect(listA.every((row) => row.restaurantId === undefined)).toBe(true);
  });

  it('keeps a payment event out of the list of the restaurant that does not own it', async () => {
    const { diner, payment } = await pendingPayment('000000000000000000000023');
    const other = await makeDiner();
    const raw = captureBody(payment.providerOrderId ?? '');
    await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));

    expect((await listWebhookEventsForRestaurant(diner.restaurantId)).map((row) => row.reference)).toEqual([
      payment.providerOrderId,
    ]);
    expect(await listWebhookEventsForRestaurant(other.restaurantId)).toEqual([]);
  });
});

describe('payment state transitions a forged or reordered event cannot force', () => {
  it('will not settle the same bill twice from two different deliveries', async () => {
    const { bill, payment } = await pendingPayment('000000000000000000000024');
    const first = await handleGatewayWebhook(
      'MOCK',
      captureBody(payment.providerOrderId ?? '', 'pay_first'),
      hmacHex(env.PAYMENT_WEBHOOK_SECRET, captureBody(payment.providerOrderId ?? '', 'pay_first')),
    );
    expect(first.ok).toBe(true);
    const settledAt = (await PaymentModel.findById(payment._id).lean())?.verifiedAt;

    // Different bytes, so a different delivery id: this reaches the payment itself, and the payment
    // refuses to be settled a second time rather than re-running the bill and the kitchen.
    const second = await handleGatewayWebhook(
      'MOCK',
      captureBody(payment.providerOrderId ?? '', 'pay_second'),
      hmacHex(env.PAYMENT_WEBHOOK_SECRET, captureBody(payment.providerOrderId ?? '', 'pay_second')),
    );
    expect(second).toMatchObject({ ok: true, message: 'Already settled' });

    const after = await PaymentModel.findById(payment._id).lean();
    expect(after?.providerPaymentId).toBe('pay_first');
    expect(after?.verifiedAt?.getTime()).toBe(settledAt?.getTime());
    expect(await BillModel.findById(bill._id).lean()).toMatchObject({ status: 'PAID' });
    expect(await markPaymentSucceeded({ providerOrderId: payment.providerOrderId ?? '' })).toEqual({
      ok: true,
      message: 'Already settled',
    });
  });

  it('will not un-settle a paid bill with a late failure', async () => {
    const { payment, bill } = await pendingPayment('000000000000000000000025');
    const raw = captureBody(payment.providerOrderId ?? '');
    await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));

    expect(await markPaymentFailed({ providerOrderId: payment.providerOrderId ?? '', reason: 'Late decline' })).toEqual({
      ok: true,
    });
    expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('SUCCEEDED');
    expect(await BillModel.findById(bill._id).lean()).toMatchObject({ status: 'PAID', paymentStatus: 'PAID' });
  });

  it('does settle a payment that failed first, because a retry can succeed', async () => {
    const { payment } = await pendingPayment('000000000000000000000026');
    await markPaymentFailed({ providerOrderId: payment.providerOrderId ?? '', reason: 'Bank timeout' });
    expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('FAILED');

    const raw = captureBody(payment.providerOrderId ?? '');
    expect((await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw))).ok).toBe(true);
    expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('SUCCEEDED');
  });

  it('will not settle a reference belonging to no payment of any tenant', async () => {
    const raw = captureBody('order_that_does_not_exist');
    const result = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(await PaymentModel.countDocuments({ status: 'SUCCEEDED' })).toBe(0);
    // Nothing was acted on, so nothing is reserved: the gateway's retry of a real event stays believed.
    expect(await WebhookEventModel.countDocuments({ provider: 'MOCK' })).toBe(0);
  });
});

describe('rotating a webhook secret without losing the deliveries in flight', () => {
  /** A key of the shape a real host holds: 32 random bytes, nothing a template would print. */
  const freshKey = () => randomBytes(32).toString('hex');

  /** Puts the process onto `live`, optionally honouring `previous` as the key being retired. */
  async function withRotation<T>(live: string, previous: string | undefined, act: () => Promise<T>): Promise<T> {
    const heldLive = env.PAYMENT_WEBHOOK_SECRET;
    const heldPrevious = env.PAYMENT_WEBHOOK_SECRET_PREVIOUS;
    env.PAYMENT_WEBHOOK_SECRET = live;
    if (previous === undefined) delete env.PAYMENT_WEBHOOK_SECRET_PREVIOUS;
    else env.PAYMENT_WEBHOOK_SECRET_PREVIOUS = previous;
    try {
      return await act();
    } finally {
      env.PAYMENT_WEBHOOK_SECRET = heldLive;
      if (heldPrevious === undefined) delete env.PAYMENT_WEBHOOK_SECRET_PREVIOUS;
      else env.PAYMENT_WEBHOOK_SECRET_PREVIOUS = heldPrevious;
    }
  }

  it('still believes the old key while the new one is being swapped in', async () => {
    const { payment } = await pendingPayment('000000000000000000000031');
    const raw = captureBody(payment.providerOrderId ?? '');
    const oldKey = freshKey();
    const newKey = freshKey();

    // The gateway re-pointed its endpoint minutes ago and is retrying what it queued before that, so a
    // delivery signed with the key it used to hold is genuine traffic and must not be thrown away.
    const outcome = await withRotation(newKey, oldKey, async () => {
      const result = await handleGatewayWebhook('MOCK', raw, hmacHex(oldKey, raw));
      return { result, payment: await PaymentModel.findById(payment._id).lean() };
    });
    expect(outcome.result.ok).toBe(true);
    expect(outcome.payment?.status).toBe('SUCCEEDED');
  });

  it('stops believing the old key the moment the window is closed', async () => {
    const { payment } = await pendingPayment('000000000000000000000032');
    const raw = captureBody(payment.providerOrderId ?? '');
    const oldKey = freshKey();
    const newKey = freshKey();

    const refused = await withRotation(newKey, undefined, () => handleGatewayWebhook('MOCK', raw, hmacHex(oldKey, raw)));
    expect(refused).toMatchObject({ ok: false, status: 401 });
    expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('PENDING');

    // The new key works on a body of the same shape, which proves it was the key being refused, not the event.
    const fresh = await pendingPayment('000000000000000000000033');
    const second = captureBody(fresh.payment.providerOrderId ?? '');
    const accepted = await withRotation(newKey, undefined, () => handleGatewayWebhook('MOCK', second, hmacHex(newKey, second)));
    expect(accepted.ok).toBe(true);
    expect((await PaymentModel.findById(fresh.payment._id).lean())?.status).toBe('SUCCEEDED');
  });

  it('refuses a key this repository published, even filed under the rotation name', async () => {
    const { payment } = await pendingPayment('000000000000000000000034');
    const raw = captureBody(payment.providerOrderId ?? '');

    const leaked = 'dev-webhook-secret';

    // The leaked default is exactly the value an attacker can sign with. A grace period for it would not
    // be a rotation, it would be the same hole given a second variable name.
    const refused = await withRotation(freshKey(), leaked, () => handleGatewayWebhook('MOCK', raw, hmacHex(leaked, raw)));
    expect(refused).toMatchObject({ ok: false, status: 401 });
    expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('PENDING');
  });
});
