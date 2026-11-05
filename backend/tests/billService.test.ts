import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, makeDiner, resetDb } from './helpers';
import { env } from '../src/config/env';
import { hmacHex, randomToken } from '../src/utils/tokens';
import { BillServiceError, claimBillIntent, createBillIntent, readQueue, settleBillIntent } from '../src/integrations/billService';
import { handleGatewayWebhook } from '../src/modules/payments/payments.webhook';
import { createBill, getBill, recordCashPayment } from '../src/services/billing.service';
import { createOrder } from '../src/services/order.service';
import { openSession } from '../src/services/table.service';
import { BillModel, OrderModel, PaymentModel, TableModel, TableSessionModel } from '../src/models';

/**
 * A stub of the bill service that speaks its real protocol: it verifies the signature over
 * `METHOD /path . timestamp . nonce . body` exactly as that app does, so these tests exercise the
 * contract Sizzle depends on rather than a mock of Sizzle's own code.
 */
const SECRET = 'test-bill-service-secret';
const KEY = 'sizzle-pay';

interface StubIntent {
  id: string;
  code: string;
  token: string;
  payUrl: string;
  status: string;
  paymentStatus: string;
  amountPaise: number;
  amountRupees: number;
  upiUri: string;
  qrDataUrl: string;
  payeeVpa: string;
  payeeVpaMasked: string;
  payeeName: string;
  note: string;
  customerLabel: string;
  tableNumber: string | null;
  externalBillId: string;
  utr: string | null;
  paidAt: string | null;
  verifiedByName: string | null;
  payeeReadable: boolean;
}

const intents = new Map<string, StubIntent>();
const seen: { target: string; signatureOk: boolean }[] = [];
let rejectSignatures = false;

function verify(req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined> }, rawBody: string): boolean {
  const url = new URL(req.url ?? '/', 'http://stub');
  const target = `${(req.method ?? 'GET').toUpperCase()} ${url.pathname}`;
  const signature = String(req.headers['x-pay-signature'] ?? '');
  const timestamp = String(req.headers['x-pay-timestamp'] ?? '');
  const nonce = String(req.headers['x-pay-nonce'] ?? '');
  seen.push({ target, signatureOk: !rejectSignatures && hmacHex(SECRET, `${target}.${timestamp}.${nonce}.${rawBody}`) === signature });
  return seen[seen.length - 1].signatureOk && String(req.headers['x-pay-key'] ?? '') === KEY;
}

function viewOf(intent: StubIntent) {
  return { ...intent };
}

function handlePost(path: string, rawBody: string): { status: number; body: unknown } {
  if (path === '/api/v1/intents') {
    const input = JSON.parse(rawBody) as {
      externalBillId: string;
      externalBillNumber: string;
      amountRupees: number;
      externalTableNumber?: string | null;
      customerLabel: string;
    };
    const existing = intents.get(input.externalBillId);
    if (existing) {
      // Idempotent on the bill id, like the real service: same token, amount synced.
      existing.amountRupees = input.amountRupees;
      existing.amountPaise = Math.round(input.amountRupees * 100);
      return { status: 200, body: { ok: true, reused: true, intent: viewOf(existing) } };
    }
    const created: StubIntent = {
      id: `intent_${randomToken(8)}`,
      code: input.externalBillNumber,
      token: randomToken(16),
      payUrl: '',
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'PENDING',
      amountPaise: Math.round(input.amountRupees * 100),
      amountRupees: input.amountRupees,
      upiUri: `upi://pay?pa=stub-cafe%40okhdfcbank&am=${input.amountRupees.toFixed(2)}`,
      qrDataUrl: 'data:image/png;base64,stub',
      payeeVpa: 'stub-cafe@okhdfcbank',
      payeeVpaMasked: 'stu••••@okhdfcbank',
      payeeName: 'Stub Cafe',
      note: `Bill ${input.externalBillNumber}`,
      customerLabel: input.customerLabel,
      tableNumber: input.externalTableNumber ?? null,
      externalBillId: input.externalBillId,
      utr: null,
      paidAt: null,
      verifiedByName: null,
      payeeReadable: true,
    };
    created.payUrl = `http://stub.test/pay/${created.token}`;
    intents.set(input.externalBillId, created);
    return { status: 200, body: { ok: true, reused: false, intent: viewOf(created) } };
  }

  const settle = path.match(/^\/api\/v1\/intents\/([^/]+)\/settle$/);
  if (settle) {
    const body = JSON.parse(rawBody) as { utr?: string; outcome?: string; reason?: string; actor?: { role: string } };
    // The rule the whole pairing rests on, enforced by the service, not by the caller remembering it.
    if (body.actor?.role === 'MANAGER') {
      return { status: 403, body: { ok: false, code: 'FORBIDDEN', message: 'A MANAGER may only read this screen — they cannot confirm or reject a payment.' } };
    }
    const intent = findIntent(settle[1]);
    if (!intent) return { status: 404, body: { ok: false, message: 'No such payment request' } };
    if (body.outcome === 'FAILED') {
      intent.paymentStatus = 'FAILED';
      return { status: 200, body: { ok: true, intent: viewOf(intent) } };
    }
    if (!body.utr) return { status: 400, body: { ok: false, message: 'utr is required' } };
    intent.paymentStatus = 'PAID';
    intent.utr = body.utr;
    intent.paidAt = new Date().toISOString();
    intent.status = 'IN_KITCHEN';
    return { status: 200, body: { ok: true, intent: viewOf(intent) } };
  }

  const claim = path.match(/^\/api\/v1\/intents\/([^/]+)\/claim$/);
  if (claim) {
    const intent = findIntent(claim[1]);
    if (!intent) return { status: 404, body: { ok: false, message: 'No such payment request' } };
    intent.paymentStatus = 'PAYMENT_VERIFICATION_PENDING';
    return { status: 200, body: { ok: true, intent: viewOf(intent) } };
  }

  const cancel = path.match(/^\/api\/v1\/intents\/([^/]+)\/cancel$/);
  if (cancel) {
    const intent = findIntent(cancel[1]);
    if (intent) intent.paymentStatus = 'CANCELLED';
    return { status: 200, body: { ok: true, intent: intent ? viewOf(intent) : null } };
  }

  if (path === '/api/v1/settings/payee') {
    return { status: 200, body: { ok: true, settings: { payeeMasked: 'stu••••@okhdfcbank' } } };
  }

  return { status: 404, body: { ok: false, message: `stub: no route for ${path}` } };
}

/** A bill id, an intent id or a token all resolve — like `findIntentAny` in the real service. */
function findIntent(ref: string): StubIntent | undefined {
  const decoded = decodeURIComponent(ref);
  for (const intent of intents.values()) {
    if (intent.externalBillId === decoded || intent.id === decoded || intent.token === decoded) return intent;
  }
  return undefined;
}

let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://stub').pathname;
      if (!verify(req, raw)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Signature verification failed' }));
        return;
      }
      const result = req.method === 'POST' ? handlePost(path, raw) : readRoute(path);
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  env.BILL_SERVICE_BASE_URL = base;
  env.BILL_SERVICE_KEY = KEY;
});

function readRoute(path: string): { status: number; body: unknown } {
  if (path === '/api/v1/queue') {
    const all = [...intents.values()];
    const claims = all.filter((intent) => intent.paymentStatus === 'PAYMENT_VERIFICATION_PENDING');
    return {
      status: 200,
      body: { ok: true, awaitingVerification: claims, open: all.filter((intent) => !claims.includes(intent)) },
    };
  }
  if (path === '/api/v1/settings/payee') {
    return { status: 200, body: { ok: true, settings: { payeeMasked: 'stu••••@okhdfcbank', payeeName: 'Stub Cafe', enabled: true } } };
  }
  const intent = findIntent(path.replace('/api/v1/intents/', ''));
  if (path.startsWith('/api/v1/intents/') && intent) return { status: 200, body: { ok: true, intent: viewOf(intent) } };
  return { status: 404, body: { ok: false, message: 'No such payment request' } };
}

afterAll(async () => {
  env.BILL_SERVICE_BASE_URL = undefined;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
  intents.clear();
  seen.length = 0;
  rejectSignatures = false;
});

afterAll(async () => {
  await disconnectTestDb();
});

const cashier = (id: string) => ({ userId: id, role: 'CASHIER' as const, name: 'Rohit' });

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
    actor: cashier(diner.cashierId),
    sessionId: String(session._id),
  });
  return { diner, bill, session };
}

describe('finalising a bill raises the payment by itself', () => {
  it('creates one signed intent request and mirrors it as an open UPI payment', async () => {
    const { bill } = await issuedBill();

    expect(seen.map((call) => call.target)).toContain('POST /api/v1/intents');
    expect(seen.every((call) => call.signatureOk)).toBe(true);

    const payments = await PaymentModel.find({ billId: bill._id }).lean();
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: 'UPI', provider: 'UPI_DIRECT', status: 'PENDING', amount: bill.grandTotal });

    const intent = intents.get(String(bill._id));
    expect(intent).toBeTruthy();
    expect(payments[0].providerOrderId).toBe(intent?.id);
    expect(payments[0].checkoutUrl).toBe(intent?.payUrl);
  });

  it('hands the counter the service QR and its pay page, not a locally minted one', async () => {
    const { bill } = await issuedBill();
    const result = await getBill(String(bill.restaurantId), String(bill._id));

    expect(result.upi).toMatchObject({
      upiId: 'stub-cafe@okhdfcbank',
      payeeName: 'Stub Cafe',
      paymentStatus: 'PENDING',
      amount: bill.grandTotal,
    });
    expect(result.upi?.qrDataUrl).toBe('data:image/png;base64,stub');
    expect(result.upi?.payUrl).toBe(intents.get(String(bill._id))?.payUrl);
  });

  it('re-issuing the same bill reuses the request, so a printed QR still works', async () => {
    const { bill } = await issuedBill();
    const first = intents.get(String(bill._id));
    await createBillIntent({
      externalBillId: String(bill._id),
      externalBillNumber: bill.billNumber,
      customerLabel: 'Table L1',
      amountRupees: bill.grandTotal,
    });
    expect(intents.get(String(bill._id))?.token).toBe(first?.token);
    expect(await PaymentModel.countDocuments({ billId: bill._id })).toBe(1);
  });

  it('a tampered body is refused by the service, so nothing is recorded', async () => {
    rejectSignatures = true;
    const diner = await makeDiner();
    await expect(
      createBillIntent({ externalBillId: 'tampered-bill', externalBillNumber: 'INV-X', customerLabel: 'Guest', amountRupees: 100 }),
    ).rejects.toBeInstanceOf(BillServiceError);
  });
});

describe('the bill service talking back', () => {
  it('a forged callback cannot settle, claim or capture', async () => {
    const { bill } = await issuedBill();
    const intent = intents.get(String(bill._id))!;
    const raw = JSON.stringify({ event: 'payment.captured', order_id: intent.id, payment_id: 'x' });

    expect(await handleGatewayWebhook('UPI_DIRECT', raw, hmacHex('not-the-secret', raw))).toMatchObject({ ok: false, status: 401 });
    expect(await handleGatewayWebhook('UPI_DIRECT', raw, '')).toMatchObject({ ok: false, status: 401 });
    expect(await handleGatewayWebhook('MOCK', raw, hmacHex(SECRET, raw))).toMatchObject({ ok: false, status: 401 });
    expect((await PaymentModel.findOne({ billId: bill._id }).lean())?.status).toBe('PENDING');
    expect((await BillModel.findById(bill._id).lean())?.paymentStatus).toBe('UNPAID');
  });

  it('a claim raises verification without touching the bill, the table or the kitchen', async () => {
    const { bill, session } = await issuedBill();
    const intent = intents.get(String(bill._id))!;
    const payment = await PaymentModel.findOne({ billId: bill._id }).lean();

    const raw = JSON.stringify({ event: 'payment.verification_pending', order_id: intent.id, amount_paise: intent.amountPaise });
    const result = await handleGatewayWebhook('UPI_DIRECT', raw, hmacHex(SECRET, raw));
    expect(result).toMatchObject({ ok: true });

    expect((await PaymentModel.findById(payment?._id).lean())?.status).toBe('VERIFICATION_PENDING');
    const stillUnpaid = await BillModel.findById(bill._id).lean();
    expect(stillUnpaid).toMatchObject({ status: 'ISSUED', paymentStatus: 'UNPAID' });
    expect((await TableSessionModel.findById(session._id).lean())?.status).toBe('PAYMENT_PENDING');
    const orders = await OrderModel.find({ _id: { $in: bill.orderIds } }).lean();
    expect(orders.every((order) => order.paymentStatus !== 'PAID')).toBe(true);
  });

  it('a signed capture settles the bill, closes the table and keeps the UTR as proof', async () => {
    const { diner, bill, session } = await issuedBill();
    const intent = intents.get(String(bill._id))!;
    intent.paymentStatus = 'PAID';
    intent.utr = '412345678901';

    const claim = await handleGatewayWebhook(
      'UPI_DIRECT',
      JSON.stringify({ event: 'payment.verification_pending', order_id: intent.id }),
      hmacHex(SECRET, JSON.stringify({ event: 'payment.verification_pending', order_id: intent.id })),
    );
    expect(claim.ok).toBe(true);

    const capturedBody = JSON.stringify({ event: 'payment.captured', order_id: intent.id, payment_id: 'stub_pay_1', utr: '412345678901' });
    const captured = await handleGatewayWebhook('UPI_DIRECT', capturedBody, hmacHex(SECRET, capturedBody));
    expect(captured.ok).toBe(true);

    const payment = await PaymentModel.findOne({ billId: bill._id }).lean();
    expect(payment).toMatchObject({ status: 'SUCCEEDED', transactionId: '412345678901' });
    expect(payment?.verifiedAt).toBeTruthy();

    const paid = await BillModel.findById(bill._id).lean();
    expect(paid).toMatchObject({ status: 'PAID', paymentStatus: 'PAID' });
    expect((await TableModel.findById(bill.tableId).lean())?.status).toBe('CLEANING');
    expect((await TableSessionModel.findById(session._id).lean())?.status).toBe('CLOSED');

    const replayBody = capturedBody;
    expect(await handleGatewayWebhook('UPI_DIRECT', replayBody, hmacHex(SECRET, replayBody))).toMatchObject({
      ok: true,
      message: 'Duplicate delivery ignored',
    });
    expect(await PaymentModel.countDocuments({ billId: bill._id, status: 'SUCCEEDED' })).toBe(1);

    // The kitchen never sees a paid bill go back through the pass.
    const orders = await OrderModel.find({ _id: { $in: paid?.orderIds } }).lean();
    expect(orders.every((order) => order.status === 'COMPLETED' && order.paymentStatus === 'PAID')).toBe(true);
    expect(diner.restaurantId).toBeTruthy();
  });

  it('a rejection is recorded as a failure, and the bill stays open', async () => {
    const { bill } = await issuedBill();
    const intent = intents.get(String(bill._id))!;
    const failedBody = JSON.stringify({
      event: 'payment.failed',
      order_id: intent.id,
      payload: { payment: { entity: { order_id: intent.id, error_description: 'Nothing for this bill in the statement' } } },
    });
    expect((await handleGatewayWebhook('UPI_DIRECT', failedBody, hmacHex(SECRET, failedBody))).ok).toBe(true);
    expect((await PaymentModel.findOne({ billId: bill._id }).lean())?.status).toBe('FAILED');
    expect((await BillModel.findById(bill._id).lean())?.paymentStatus).toBe('UNPAID');
  });
});

describe('the two role rules the dashboard rests on', () => {
  it('the service refuses to let a manager confirm money', async () => {
    const { bill } = await issuedBill();
    const intent = intents.get(String(bill._id))!;
    // The counter raises the claim...
    await expect(claimBillIntent(intent.id, { role: 'CASHIER', name: 'Rohit' })).resolves.toMatchObject({ ok: true });

    // ...and a manager relaying the same settle is refused by the service itself.
    const error = await settleBillIntent(intent.id, { role: 'MANAGER', name: 'Neha' }, { utr: '123456789012' }).catch((e) => e);
    expect(error).toBeInstanceOf(BillServiceError);
    expect((error as BillServiceError).status).toBe(403);
    expect((error as BillServiceError).message).toMatch(/only read/i);
    expect(intent.paymentStatus).toBe('PAYMENT_VERIFICATION_PENDING');
  });

  it('the queue a manager reads is the same list, with no write door beside it', async () => {
    const { bill } = await issuedBill();
    const intent = intents.get(String(bill._id))!;
    await claimBillIntent(intent.id, { role: 'CASHIER', name: 'Rohit' });

    const queue = await readQueue();
    expect(queue.awaitingVerification.map((row) => row.externalBillId)).toContain(String(bill._id));
    expect(queue.open.some((row) => row.id === intent.id)).toBe(false);
  });
});

describe('cash at the counter closes the table QR', () => {
  it('fails the open UPI row and asks the service to cancel the request', async () => {
    const { diner, bill } = await issuedBill();
    const intent = intents.get(String(bill._id))!;

    await recordCashPayment({
      restaurantId: diner.restaurantId,
      billId: String(bill._id),
      actor: cashier(diner.cashierId),
      tendered: bill.grandTotal,
    });

    expect(intent.paymentStatus).toBe('CANCELLED');
    expect(seen.map((call) => call.target)).toContain(`POST /api/v1/intents/${bill._id}/cancel`);
    const rows = await PaymentModel.find({ billId: bill._id }).lean();
    const cash = rows.find((row) => row.method === 'CASH');
    const upi = rows.find((row) => row.provider === 'UPI_DIRECT');
    expect(cash?.status).toBe('SUCCEEDED');
    expect(upi?.status).toBe('FAILED');
    expect(upi?.failureReason).toMatch(/cash/i);
    // Only the cash counts as income; the closed QR is not a second payment.
    expect(await PaymentModel.countDocuments({ billId: bill._id, status: 'SUCCEEDED' })).toBe(1);
    expect((await BillModel.findById(bill._id).lean())?.paymentStatus).toBe('PAID');
  });
});
