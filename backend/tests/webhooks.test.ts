import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, makeDiner, resetDb } from './helpers';
import { env } from '../src/config/env';
import { hmacHex } from '../src/utils/tokens';
import { handleGatewayWebhook } from '../src/modules/payments/payments.webhook';
import { handleDeliveryWebhook } from '../src/modules/integrations/delivery.webhook';
import { createBill, startOnlinePayment } from '../src/services/billing.service';
import { createOrder } from '../src/services/order.service';
import { openSession } from '../src/services/table.service';
import { BillModel, NotificationModel, OrderModel, PaymentModel, TableModel, TableSessionModel, WebhookEventModel } from '../src/models';
import { listWebhookEventsForRestaurant } from '../src/services/webhookEvent.service';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

const cashierActor = (id: string) => ({ userId: id, role: 'CASHIER' as const, name: 'Rohit' });

async function issuedBill() {
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
    actor: cashierActor(diner.cashierId),
    sessionId: String(session._id),
  });
  return { diner, bill };
}

describe('payment gateway webhooks', () => {
  it('rejects unknown providers and unsigned payloads', async () => {
    expect(await handleGatewayWebhook('stripe', '{}', 'sig')).toMatchObject({ ok: false, status: 404 });
    expect(await handleGatewayWebhook('MOCK', '{}', '')).toMatchObject({ ok: false, status: 401 });
  });

  it('only settles a bill behind a valid signature', async () => {
    const { bill } = await issuedBill();
    const payment = await startOnlinePayment({
      restaurantId: String(bill.restaurantId),
      billId: String(bill._id),
      actor: cashierActor('000000000000000000000001'),
      method: 'UPI',
    });
    expect(payment.status).toBe('PENDING');
    expect(payment.provider).toBe('MOCK');
    expect(bill.grandTotal).toBe(211); // 180 + 12% GST + 5% service, rounded to the rupee

    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_test_1', order_id: payment.providerOrderId } } },
    });

    const forged = await handleGatewayWebhook('MOCK', raw, hmacHex('wrong-secret', raw));
    expect(forged).toMatchObject({ ok: false, status: 401 });
    expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('PENDING');

    const accepted = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
    expect(accepted.ok).toBe(true);

    const settled = await PaymentModel.findById(payment._id).lean();
    expect(settled?.status).toBe('SUCCEEDED');
    expect(settled?.providerPaymentId).toBe('pay_test_1');
    expect(settled?.verifiedAt).toBeTruthy();

    const paidBill = await BillModel.findById(bill._id).lean();
    expect(paidBill).toMatchObject({ status: 'PAID', paymentStatus: 'PAID' });
    const orders = await OrderModel.find({ _id: { $in: paidBill?.orderIds } }).lean();
    expect(orders.every((order) => order.paymentStatus === 'PAID' && order.status === 'COMPLETED')).toBe(true);

    const table = await TableModel.findById(bill.tableId).lean();
    expect(table?.status).toBe('CLEANING');
    const session = await TableSessionModel.findById(bill.tableSessionId).lean();
    expect(session?.status).toBe('CLOSED');
    expect(session?.closedAt).toBeTruthy();

    // A gateway that retries the same delivery gets a 200 so it stops, and finds nothing changed.
    const beforeReplay = await PaymentModel.findById(payment._id).lean();
    const replay = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
    expect(replay).toMatchObject({ ok: true, status: 200, message: 'Duplicate delivery ignored' });

    const afterReplay = await PaymentModel.findById(payment._id).lean();
    expect(afterReplay?.status).toBe('SUCCEEDED');
    expect(afterReplay?.verifiedAt?.getTime()).toBe(beforeReplay?.verifiedAt?.getTime());
    expect(await WebhookEventModel.countDocuments({ provider: 'MOCK', reference: payment.providerOrderId })).toBe(1);
  });

  it('refuses a body that was changed after it was signed', async () => {
    const { bill } = await issuedBill();
    const payment = await startOnlinePayment({
      restaurantId: String(bill.restaurantId),
      billId: String(bill._id),
      actor: cashierActor('000000000000000000000009'),
      method: 'UPI',
    });

    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_test_2', order_id: payment.providerOrderId, amount: 21100 } } },
    });
    const signature = hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw);

    // The bytes a stranger sends are not the bytes that were signed, so the signature no longer fits them.
    const tampered = raw.replace('21100', '1');
    const rejected = await handleGatewayWebhook('MOCK', tampered, signature);
    expect(rejected).toMatchObject({ ok: false, status: 401, message: 'Signature verification failed' });
    expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('PENDING');
    expect((await BillModel.findById(bill._id).lean())?.paymentStatus).toBe('UNPAID');
    // A message that never cleared the signature is not even recorded as a delivery.
    expect(await WebhookEventModel.countDocuments({ provider: 'MOCK', reference: payment.providerOrderId })).toBe(0);
  });

  it('acts on one event id once, even when the sender re-sends it in other bytes', async () => {
    const { bill } = await issuedBill();
    const payment = await startOnlinePayment({
      restaurantId: String(bill.restaurantId),
      billId: String(bill._id),
      actor: cashierActor('000000000000000000000010'),
      method: 'UPI',
    });

    const body = (attempt: string) =>
      JSON.stringify({
        event: 'payment.captured',
        event_id: 'evt_shared_1',
        payload: { payment: { entity: { id: `pay_${attempt}`, order_id: payment.providerOrderId } } },
      });

    const first = await handleGatewayWebhook('MOCK', body('a'), hmacHex(env.PAYMENT_WEBHOOK_SECRET, body('a')));
    expect(first.ok).toBe(true);
    expect((await PaymentModel.findById(payment._id).lean())?.providerPaymentId).toBe('pay_a');

    // A retry that restamps the payment id but keeps the event id is still the same event.
    const second = await handleGatewayWebhook('MOCK', body('b'), hmacHex(env.PAYMENT_WEBHOOK_SECRET, body('b')));
    expect(second).toMatchObject({ ok: true, message: 'Duplicate delivery ignored' });
    expect((await PaymentModel.findById(payment._id).lean())?.providerPaymentId).toBe('pay_a');
  });

  it('keeps a delivery that named no payment out of the ledger', async () => {
    const raw = JSON.stringify({ event: 'payment.captured', event_id: 'evt_orphan_1', payload: { payment: { entity: {} } } });
    const result = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
    expect(result).toMatchObject({ ok: false, status: 400 });
    // Nothing was acted on, so nothing is filed: the claim is given back rather than left as a
    // reservation, and a message that named no payment belongs to no tenant's review list.
    expect(await WebhookEventModel.countDocuments({ eventId: 'event:evt_orphan_1' })).toBe(0);
    expect(await listWebhookEventsForRestaurant('000000000000000000000001')).toEqual([]);
  });

  it('records the outcome of a delivery it accepted', async () => {
    const { bill } = await issuedBill();
    const payment = await startOnlinePayment({
      restaurantId: String(bill.restaurantId),
      billId: String(bill._id),
      actor: cashierActor('000000000000000000000011'),
      method: 'UPI',
    });
    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_test_3', order_id: payment.providerOrderId } } },
    });
    await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));

    const ledger = await listWebhookEventsForRestaurant(String(bill.restaurantId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ provider: 'MOCK', event: 'payment.captured', reference: payment.providerOrderId });
    expect(ledger[0]?.outcome).toBe('accepted:200');
    expect(ledger[0]).not.toHaveProperty('rawBody');
  });

  it('gives the claim back when the event was about a payment that does not exist', async () => {
    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_ghost', order_id: 'order_never_issued' } } },
    });
    const result = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
    expect(result).toMatchObject({ ok: false, status: 404 });
    // The gateway will retry, and a reservation left standing would turn that retry into a silent drop.
    expect(await WebhookEventModel.countDocuments({ provider: 'MOCK', reference: 'order_never_issued' })).toBe(0);
  });

  it('will not fail a payment it cannot point at', async () => {
    const raw = JSON.stringify({
      event: 'payment.failed',
      payload: { payment: { entity: { error_description: 'Payment declined by bank' } } },
    });
    const result = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('records failures without touching the bill', async () => {
    const { bill } = await issuedBill();
    const payment = await startOnlinePayment({
      restaurantId: String(bill.restaurantId),
      billId: String(bill._id),
      actor: cashierActor('000000000000000000000002'),
      method: 'CARD',
    });

    const raw = JSON.stringify({
      event: 'payment.failed',
      payload: { payment: { entity: { order_id: payment.providerOrderId, error_description: 'Card declined' } } },
    });
    const result = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
    expect(result.ok).toBe(true);

    expect((await PaymentModel.findById(payment._id).lean())?.status).toBe('FAILED');
    expect((await BillModel.findById(bill._id).lean())?.paymentStatus).toBe('UNPAID');
  });
});

describe('delivery partner webhooks', () => {
  const swiggyPayload = (externalId: string) =>
    JSON.stringify({
      event: 'order_placed',
      order: {
        order_id: externalId,
        customer: { name: 'Ritika Sharma', phone: '9812345670', address: '7 Sunbeam Apartments, Koregaon Park', city: 'Pune' },
        items: [
          { name: 'Butter Chicken', price: 340, quantity: 1 },
          { name: 'Garlic Naan', price: 60, quantity: 3 },
        ],
        instructions: 'Ring the bell twice',
        payment_status: 'PAID',
      },
    });

  it('rejects an unsigned or tampered body', async () => {
    const raw = swiggyPayload('sw-1');
    expect(await handleDeliveryWebhook({ provider: 'swiggy', rawBody: raw })).toMatchObject({ ok: false, status: 401 });
    expect(
      await handleDeliveryWebhook({ provider: 'swiggy', rawBody: raw, signature: hmacHex('wrong', raw) }),
    ).toMatchObject({ ok: false, status: 401 });
    expect(await handleDeliveryWebhook({ provider: 'ubereats', rawBody: raw, signature: 'x' })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it('asks for ?rid= when more than one restaurant exists', async () => {
    await makeDiner();
    await makeDiner();
    const raw = swiggyPayload('sw-2');
    const result = await handleDeliveryWebhook({
      provider: 'swiggy',
      rawBody: raw,
      signature: hmacHex(env.SWIGGY_WEBHOOK_SECRET, raw),
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(result.message).toContain('?rid=');
  });

  it('refuses a signed body whose contents were swapped afterwards', async () => {
    const diner = await makeDiner();
    const raw = swiggyPayload('sw-tampered');
    const signature = hmacHex(env.SWIGGY_WEBHOOK_SECRET, raw);

    const result = await handleDeliveryWebhook({
      provider: 'swiggy',
      rawBody: raw.replace('"quantity":3', '"quantity":30'),
      signature,
      restaurantId: diner.restaurantId,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(await OrderModel.countDocuments({ restaurantId: diner.restaurantId, source: 'SWIGGY' })).toBe(0);
    expect(await WebhookEventModel.countDocuments({ provider: 'SWIGGY' })).toBe(0);
  });

  it('ingests a signed Swiggy order exactly once', async () => {
    const diner = await makeDiner();
    const raw = swiggyPayload('sw-3');
    const signature = hmacHex(env.SWIGGY_WEBHOOK_SECRET, raw);

    const first = await handleDeliveryWebhook({
      provider: 'swiggy',
      rawBody: raw,
      signature,
      restaurantId: diner.restaurantId,
    });
    expect(first).toMatchObject({ ok: true, status: 201, duplicate: false });

    const order = await OrderModel.findById(first.orderId).lean();
    expect(order).toMatchObject({
      source: 'SWIGGY',
      externalOrderId: 'sw-3',
      customerName: 'Ritika Sharma',
      status: 'PLACED',
      subtotal: 520,
      serviceCharge: 0,
      taxTotal: 26,
      grandTotal: 546,
    });
    expect(order?.notes).toBe('Ring the bell twice');
    expect(order?.integrationMeta).toMatchObject({ paymentState: 'PAID' });

    const alerts = await NotificationModel.countDocuments({
      restaurantId: diner.restaurantId,
      type: 'DELIVERY_ORDER',
    });
    expect(alerts).toBeGreaterThan(0);

    const replay = await handleDeliveryWebhook({
      provider: 'swiggy',
      rawBody: raw,
      signature,
      restaurantId: diner.restaurantId,
    });
    expect(replay).toMatchObject({ ok: true, status: 200, duplicate: true, orderId: first.orderId });
    expect(await OrderModel.countDocuments({ restaurantId: diner.restaurantId, source: 'SWIGGY' })).toBe(1);
  });

  it('unwraps Zomato and website checkout envelopes', async () => {
    const diner = await makeDiner();

    const zomatoRaw = JSON.stringify({
      event: 'order.placed',
      order: {
        id: 'zom-9',
        customer: { name: 'Aditya Nair', phone: '9811112223' },
        items: [{ name: 'Butter Chicken', price: 340, qty: 1, special_instructions: 'Less spicy' }],
        payment_status: 'paid',
      },
    });
    const zomato = await handleDeliveryWebhook({
      provider: 'zomato',
      rawBody: zomatoRaw,
      signature: hmacHex(env.ZOMATO_WEBHOOK_SECRET, zomatoRaw),
      restaurantId: diner.restaurantId,
    });
    expect(zomato).toMatchObject({ ok: true, status: 201 });
    const zomatoOrder = await OrderModel.findById(zomato.orderId).lean();
    expect(zomatoOrder).toMatchObject({ source: 'ZOMATO', externalOrderId: 'zom-9', customerName: 'Aditya Nair' });
    expect(zomatoOrder?.items[0].notes).toBe('Less spicy');

    const websiteRaw = JSON.stringify({
      event: 'checkout.completed',
      data: {
        reference: 'web-7',
        customer: { name: 'Priya Iyer', phone: '9898989898' },
        line_items: [{ name: 'Paneer Tikka', price: 260, qty: 2 }],
        payment: { status: 'captured', method: 'UPI' },
      },
    });
    const website = await handleDeliveryWebhook({
      provider: 'website',
      rawBody: websiteRaw,
      signature: hmacHex(env.WEBSITE_WEBHOOK_SECRET, websiteRaw),
      restaurantId: diner.restaurantId,
    });
    expect(website).toMatchObject({ ok: true, status: 201 });
    const websiteOrder = await OrderModel.findById(website.orderId).lean();
    expect(websiteOrder).toMatchObject({
      source: 'WEBSITE',
      externalOrderId: 'web-7',
      customerName: 'Priya Iyer',
      subtotal: 520,
    });
  });
});
