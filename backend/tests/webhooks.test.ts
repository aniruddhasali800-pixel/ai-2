import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, makeDiner, resetDb } from './helpers';
import { env } from '../src/config/env';
import { hmacHex } from '../src/utils/tokens';
import { handleGatewayWebhook } from '../src/modules/payments/payments.webhook';
import { handleDeliveryWebhook } from '../src/modules/integrations/delivery.webhook';
import { createBill, startOnlinePayment } from '../src/services/billing.service';
import { createOrder } from '../src/services/order.service';
import { openSession } from '../src/services/table.service';
import { BillModel, NotificationModel, OrderModel, PaymentModel, TableModel, TableSessionModel } from '../src/models';

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

    // Replayed webhooks are acknowledged without double-settling.
    const replay = await handleGatewayWebhook('MOCK', raw, hmacHex(env.PAYMENT_WEBHOOK_SECRET, raw));
    expect(replay).toMatchObject({ ok: true, message: 'Already settled' });
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
