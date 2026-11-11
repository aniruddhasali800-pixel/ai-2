import { Types, type HydratedDocument } from 'mongoose';
import { BillModel, CustomerRequestModel, OrderModel, PaymentModel, RestaurantModel, TableModel, TableSessionModel, nextSeq } from '../models';
import { round2, roundToRupee } from '../utils/money';
import { emit, Events } from '../realtime/emit';
import { ApiError } from '../utils/httpError';
import { dateKey, randomToken } from '../utils/tokens';
import { transitionOrder } from './order.service';
import { closeSession } from './table.service';
import { notifyRoles } from './notification.service';
import { recordAudit } from './audit.service';
import { gatewayFor, onlineGateway } from '../integrations/payments';
import { billServiceEnabled, closeBillIntent, createBillIntent, readBillIntent, type BillIntent } from '../integrations/billService';
import type { Payment } from '../models/Payment';
import { upiChargeFor } from './upi.service';
import type { PaymentMethod, Role } from '../types/constants';

interface Actor {
  userId: string | null;
  role: Role | 'SYSTEM';
  name: string;
}

async function billOr404(restaurantId: string, billId: string) {
  const bill = await BillModel.findOne({ _id: billId, restaurantId });
  if (!bill) throw ApiError.notFound('Bill not found');
  return bill;
}

/** The bill fields a payment request needs — a plain object or a document both qualify. */
interface PayableBill {
  _id: unknown;
  restaurantId: unknown;
  billNumber: string;
  grandTotal: number;
  tableNumber: string;
  customerName: string;
  orderIds: unknown[];
}

/**
 * What the counter and the guest's bill page render. Both the bill service and this tenant's own
 * UPI handle fill the same shape, so a screen never has to know which one is paired.
 */
export interface BillPayView {
  link: string;
  qrDataUrl: string;
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
  /** Set only when the bill service is collecting: the guest's own page, and the request's state. */
  payUrl?: string;
  intentId?: string;
  paymentStatus?: string;
  utr?: string | null;
}

function servicePayView(intent: BillIntent): BillPayView {
  return {
    link: intent.upiUri,
    qrDataUrl: intent.qrDataUrl,
    upiId: intent.payeeVpa,
    payeeName: intent.payeeName,
    amount: intent.amountRupees,
    note: intent.note,
    payUrl: intent.payUrl,
    intentId: intent.id,
    paymentStatus: intent.paymentStatus,
    utr: intent.utr,
  };
}

const OPEN_UPI_PAYMENT = { provider: 'UPI_DIRECT', status: { $in: ['PENDING', 'VERIFICATION_PENDING'] } };

/** Keeps the local ledger row in step with the request the bill service actually holds. */
async function mirrorUpiPayment(bill: PayableBill, intent: BillIntent): Promise<HydratedDocument<Payment>> {
  const status = intent.paymentStatus === 'PAYMENT_VERIFICATION_PENDING' ? 'VERIFICATION_PENDING' : 'PENDING';
  const existing = await PaymentModel.findOne({ billId: bill._id, provider: 'UPI_DIRECT', providerOrderId: intent.id });
  if (existing) {
    if (existing.amount !== intent.amountRupees || existing.status !== status) {
      existing.amount = intent.amountRupees;
      existing.status = status;
      existing.checkoutUrl = intent.payUrl;
      await existing.save();
    }
    return existing;
  }
  return PaymentModel.create({
    restaurantId: bill.restaurantId,
    billId: bill._id,
    orderIds: bill.orderIds,
    method: 'UPI',
    provider: 'UPI_DIRECT',
    providerOrderId: intent.id,
    amount: intent.amountRupees,
    checkoutUrl: intent.payUrl,
    status,
    meta: { token: intent.token, payeeMasked: intent.payeeVpaMasked },
  });
}

/**
 * Raises the UPI request for a bill and records the payment it stands for. Called the moment the
 * bill is finalised, so nobody has to start a payment for a table. Safe to repeat: the service
 * keys its request on the bill id and hands the same token back, so an already-printed QR keeps
 * working even after the bill total moved.
 */
async function raiseUpiRequest(bill: PayableBill): Promise<{ payment: HydratedDocument<Payment> | null; view: BillPayView } | null> {
  try {
    const { intent } = await createBillIntent({
      externalBillId: String(bill._id),
      externalBillNumber: bill.billNumber,
      externalRestaurantId: String(bill.restaurantId),
      externalTableNumber: bill.tableNumber || null,
      customerLabel: bill.customerName || (bill.tableNumber ? `Table ${bill.tableNumber}` : bill.billNumber),
      amountRupees: bill.grandTotal,
    });
    // A finished request over there is not an open payment over here. Money is only ever marked
    // received by the signed webhook; this read reports, it does not settle.
    if (intent.paymentStatus !== 'PENDING' && intent.paymentStatus !== 'PAYMENT_VERIFICATION_PENDING') {
      console.warn(`[bill-service] ${bill.billNumber} already has a ${intent.paymentStatus} request — left alone`);
      return { payment: null, view: servicePayView(intent) };
    }
    return { payment: await mirrorUpiPayment(bill, intent), view: servicePayView(intent) };
  } catch (error) {
    console.error('[bill-service] could not raise the UPI request', error);
    return null;
  }
}

/**
 * The live pay view for an unpaid bill: the paired service first, this tenant's own handle
 * otherwise. `raise` opens a request that is missing — a staff screen may do that; the public
 * guest page only reads what is already held, so a visitor cannot create ledger rows.
 */
async function payViewFor(bill: PayableBill, opts: { raise: boolean }): Promise<BillPayView | null> {
  if (billServiceEnabled()) {
    const open = await PaymentModel.findOne({ billId: bill._id, ...OPEN_UPI_PAYMENT }).lean();
    // The service resolves a bill id too, so the guest sees the QR even if the ledger row is missing.
    try {
      const read = await readBillIntent(open?.providerOrderId ?? String(bill._id));
      if (read.intent.paymentStatus === 'PENDING' || read.intent.paymentStatus === 'PAYMENT_VERIFICATION_PENDING') {
        await mirrorUpiPayment(bill, read.intent);
      }
      return servicePayView(read.intent);
    } catch (error) {
      console.error('[bill-service] intent read failed', error);
      if (opts.raise) {
        const raised = await raiseUpiRequest(bill);
        if (raised) return raised.view;
      }
      if (open) {
        // The service is not answering: show what the ledger already knows so the screen still works.
        return {
          link: '',
          qrDataUrl: '',
          upiId: '',
          payeeName: '',
          amount: open.amount,
          note: bill.billNumber,
          intentId: open.providerOrderId ?? undefined,
          utr: open.transactionId ?? null,
        };
      }
    }
  }
  return upiChargeFor(String(bill.restaurantId), bill.grandTotal, bill.billNumber);
}

/**
 * The money came in another way — cash at the counter, or a void — so the table's QR has to stop
 * asking for it. The local rows close first: even if the service cannot be reached from here, the
 * ledger never keeps a phantom open payment beside a paid bill.
 */
async function closeUpiRequest(billId: unknown, actor: Actor, reason: string): Promise<void> {
  const open = await PaymentModel.find({ billId, ...OPEN_UPI_PAYMENT });
  if (!open.length) return;
  for (const payment of open) {
    payment.status = 'FAILED';
    payment.failureReason = reason;
    await payment.save();
  }
  if (!billServiceEnabled()) return;
  try {
    await closeBillIntent(String(billId), { role: actor.role, name: actor.name }, reason);
  } catch (error) {
    console.error('[bill-service] the QR could not be closed from here — close it in the payment dashboard', error);
  }
}

/**
 * Opens (or re-reads) the UPI request for one bill — the counter's retry button, and the same call
 * a finalised bill makes for itself.
 */
export async function raiseBillIntent(restaurantId: string, billId: string): Promise<BillPayView> {
  const bill = await billOr404(restaurantId, billId);
  if (bill.status !== 'ISSUED' || bill.paymentStatus !== 'UNPAID') {
    throw ApiError.conflict('This bill is already settled');
  }
  const raised = await raiseUpiRequest(bill);
  if (!raised) throw new ApiError(502, 'The payment service did not answer — try again in a moment');
  return raised.view;
}

export async function createBill(opts: {
  restaurantId: string;
  actor: Actor;
  sessionId?: string;
  orderId?: string;
}) {
  const { restaurantId } = opts;
  let orders;

  if (opts.sessionId) {
    const session = await TableSessionModel.findOne({ _id: opts.sessionId, restaurantId }).lean();
    if (!session) throw ApiError.notFound('Table session not found');
    if (session.status === 'CLOSED') throw ApiError.conflict('This table session is already closed');

    const existing = await BillModel.findOne({
      tableSessionId: session._id,
      paymentStatus: 'UNPAID',
      status: 'ISSUED',
    }).lean();
    if (existing) return existing;

    orders = await OrderModel.find({
      tableSessionId: session._id,
      status: { $ne: 'CANCELLED' },
      billId: null,
    }).lean();
    if (!orders.length) throw ApiError.conflict('There are no unbilled orders on this table');
  } else if (opts.orderId) {
    const order = await OrderModel.findOne({ _id: opts.orderId, restaurantId }).lean();
    if (!order) throw ApiError.notFound('Order not found');
    if (order.status === 'CANCELLED') throw ApiError.conflict('A cancelled order cannot be billed');
    if (order.billId) {
      const existing = await BillModel.findById(order.billId).lean();
      if (existing) return existing;
    }
    orders = [order];
  } else {
    throw ApiError.badRequest('Provide the table session or order you want to bill');
  }

  const subtotal = round2(orders.reduce((s, o) => s + o.subtotal, 0));
  const taxTotal = round2(orders.reduce((s, o) => s + o.taxTotal, 0));
  const serviceCharge = round2(orders.reduce((s, o) => s + o.serviceCharge, 0));
  const discountAmount = round2(orders.reduce((s, o) => s + o.discountAmount, 0));
  const preRound = round2(subtotal - discountAmount + serviceCharge + taxTotal);
  const { total, roundOff } = roundToRupee(preRound);

  const breakup = new Map<string, { label: string; percent: number; amount: number }>();
  for (const order of orders) {
    const perLineTax = new Map<number, number>();
    for (const item of order.items) {
      const key = item.taxPercent ?? 0;
      perLineTax.set(key, round2((perLineTax.get(key) ?? 0) + item.lineTotal));
    }
    const orderNet = round2(order.subtotal - order.discountAmount);
    const ratio = order.subtotal > 0 ? orderNet / order.subtotal : 0;
    for (const [percent, bucket] of perLineTax) {
      const tax = round2(round2(bucket * ratio) * (percent / 100));
      if (tax <= 0) continue;
      const half = round2(tax / 2);
      const rows: [string, number][] = [
        ['CGST', half],
        ['SGST', round2(tax - half)],
      ];
      for (const [label, amount] of rows) {
        const key = `${label}:${percent}`;
        const prev = breakup.get(key);
        breakup.set(key, { label, percent: round2(percent / 2), amount: round2((prev?.amount ?? 0) + amount) });
      }
    }
  }

  const seq = await nextSeq(`bill:${restaurantId}:${dateKey()}`);
  const billNumber = `INV-${dateKey()}-${String(seq).padStart(4, '0')}`;
  const firstOrder = orders[0];
  const table = firstOrder.tableId ? await TableModel.findById(firstOrder.tableId).lean() : null;

  const bill = await BillModel.create({
    restaurantId,
    billNumber,
    orderIds: orders.map((o) => o._id),
    tableSessionId: firstOrder.tableSessionId ?? null,
    tableId: firstOrder.tableId ?? null,
    tableNumber: table?.number ?? '',
    customerName: firstOrder.customerName ?? '',
    subtotal,
    taxTotal,
    serviceCharge,
    discountAmount,
    roundOff,
    grandTotal: total,
    taxBreakup: [...breakup.values()].sort((a, b) => a.label.localeCompare(b.label)),
    status: 'ISSUED',
    paymentStatus: 'UNPAID',
    publicToken: randomToken(16),
    issuedByUserId: opts.actor.userId,
    notes: '',
  });

  await OrderModel.updateMany({ _id: { $in: orders.map((o) => o._id) } }, { billId: bill._id });

  if (bill.tableSessionId) {
    const session = await TableSessionModel.findByIdAndUpdate(
      bill.tableSessionId,
      { status: 'PAYMENT_PENDING' },
      { new: true },
    ).lean();
    if (session) emit.toSession(session.publicToken, Events.BILL_CREATED, publicBillSummary(bill, session.publicToken));
  }
  if (bill.tableId) {
    const updatedTable = await TableModel.findByIdAndUpdate(bill.tableId, { status: 'PAYMENT_PENDING' }, { new: true }).lean();
    if (updatedTable) {
      emit.toRestaurant(restaurantId, Events.TABLE_UPDATED, {
        _id: String(updatedTable._id),
        number: updatedTable.number,
        status: updatedTable.status,
      });
    }
  }

  emit.toCashier(restaurantId, Events.BILL_CREATED, bill.toObject());
  emit.toRestaurant(restaurantId, Events.BILL_UPDATED, bill.toObject());
  await notifyRoles(restaurantId, ['CASHIER', 'OWNER', 'MANAGER'], {
    type: 'BILL_REQUESTED',
    title: `Bill ${billNumber} is ready`,
    body: bill.tableNumber ? `Table ${bill.tableNumber} · ₹${total.toFixed(2)}` : `₹${total.toFixed(2)}`,
    entityType: 'Bill',
    entityId: String(bill._id),
  });
  await recordAudit({
    restaurantId,
    actorId: opts.actor.userId,
    actorName: opts.actor.name,
    action: 'bill.issued',
    entityType: 'Bill',
    entityId: String(bill._id),
    metadata: { billNumber, grandTotal: total, orders: orders.length },
  });

  // The bill is final, so the money request opens with it: the guest scans a QR from the table
  // without anyone starting a payment, and a claim lands in the verification queue by itself.
  if (total > 0 && billServiceEnabled()) await raiseUpiRequest(bill);

  return bill.toObject();
}

function publicBillSummary(bill: { _id: unknown; billNumber: string; grandTotal: number; publicToken: string }, token: string) {
  return {
    billId: String(bill._id),
    billNumber: bill.billNumber,
    grandTotal: bill.grandTotal,
    publicToken: token,
  };
}

export async function getBill(restaurantId: string, billId: string) {
  const bill = await billOr404(restaurantId, billId);
  const [orders, payments, upi] = await Promise.all([
    OrderModel.find({ _id: { $in: bill.orderIds }, restaurantId }).lean(),
    PaymentModel.find({ billId: bill._id, restaurantId }).sort({ createdAt: -1 }).lean(),
    bill.paymentStatus === 'UNPAID' ? payViewFor(bill, { raise: true }) : Promise.resolve(null),
  ]);
  return { bill: bill.toObject(), orders, payments, upi };
}

export async function listBills(
  restaurantId: string,
  filter: { unpaidOnly?: boolean; todayOnly?: boolean; search?: string; page?: number; limit?: number },
) {
  const query: Record<string, unknown> = { restaurantId };
  if (filter.unpaidOnly) {
    query.status = 'ISSUED';
    query.paymentStatus = 'UNPAID';
  }
  if (filter.todayOnly) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    query.createdAt = { $gte: start };
  }
  if (filter.search) {
    const rx = new RegExp(filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ billNumber: rx }, { tableNumber: rx }, { customerName: rx }];
  }
  const page = Math.max(1, filter.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
  const [data, total] = await Promise.all([
    BillModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    BillModel.countDocuments(query),
  ]);
  return { data, total, page, limit };
}

export async function recordCashPayment(opts: {
  restaurantId: string;
  billId: string;
  actor: Actor;
  tendered?: number;
  note?: string;
}) {
  const bill = await billOr404(opts.restaurantId, opts.billId);
  if (bill.status !== 'ISSUED' || bill.paymentStatus !== 'UNPAID') {
    throw ApiError.conflict('This bill is already settled');
  }
  const amount = bill.grandTotal;
  let change: number | null = null;
  if (opts.tendered != null) {
    if (opts.tendered < amount) throw ApiError.badRequest('Cash received is less than the bill total');
    change = round2(opts.tendered - amount);
  }

  const payment = await PaymentModel.create({
    restaurantId: opts.restaurantId,
    billId: bill._id,
    orderIds: bill.orderIds,
    method: 'CASH',
    provider: 'CASH',
    amount,
    tendered: opts.tendered ?? null,
    change,
    status: 'SUCCEEDED',
    collectedByUserId: opts.actor.userId,
    verifiedAt: new Date(),
    meta: { note: opts.note ?? '' },
  });

  await settleBill(bill._id.toString(), opts.restaurantId, payment._id.toString(), opts.actor);
  await closeUpiRequest(bill._id, opts.actor, 'Settled by cash at the counter');

  await recordAudit({
    restaurantId: opts.restaurantId,
    actorId: opts.actor.userId,
    actorName: opts.actor.name,
    action: 'payment.cash',
    entityType: 'Payment',
    entityId: String(payment._id),
    metadata: { billNumber: bill.billNumber, amount, tendered: opts.tendered ?? amount, change },
  });

  return { bill: await BillModel.findById(bill._id).lean(), payment: payment.toObject() };
}

export async function startOnlinePayment(opts: {
  restaurantId: string;
  billId: string;
  actor: Actor;
  method: Exclude<PaymentMethod, 'CASH'>;
  provider?: string;
}) {
  const bill = await billOr404(opts.restaurantId, opts.billId);
  if (bill.status !== 'ISSUED' || bill.paymentStatus !== 'UNPAID') {
    throw ApiError.conflict('This bill is already settled');
  }

  // With the bill service paired, a UPI request is its own raise path — the same one a finalised
  // bill uses, so this button can only ever re-open or report the table's existing QR.
  if (billServiceEnabled() && opts.method === 'UPI') {
    const raised = await raiseUpiRequest(bill);
    if (!raised) throw new ApiError(502, 'The payment service did not answer — take cash, or try again in a moment');
    if (!raised.payment) throw ApiError.conflict(`That request is already ${raised.view.paymentStatus} in the payment service`);
    emit.toCashier(opts.restaurantId, Events.BILL_UPDATED, { billId: String(bill._id), paymentPending: true });
    return raised.payment.toObject();
  }

  const gateway = opts.provider ? gatewayFor(opts.provider) ?? onlineGateway() : onlineGateway();
  const intent = await gateway.createIntent({
    amount: bill.grandTotal,
    currency: 'INR',
    reference: bill.billNumber,
    method: opts.method,
    notes: `Bill ${bill.billNumber}${bill.tableNumber ? ` · Table ${bill.tableNumber}` : ''}`,
    externalId: String(bill._id),
    customerLabel: bill.customerName || (bill.tableNumber ? `Table ${bill.tableNumber}` : bill.billNumber),
    tableNumber: bill.tableNumber || undefined,
  });

  const payment = await PaymentModel.create({
    restaurantId: opts.restaurantId,
    billId: bill._id,
    orderIds: bill.orderIds,
    method: opts.method,
    provider: gateway.id,
    amount: bill.grandTotal,
    providerOrderId: intent.providerOrderId,
    checkoutUrl: intent.checkoutUrl,
    status: 'PENDING',
    collectedByUserId: opts.actor.userId,
    meta: intent.meta ?? null,
  });

  emit.toRestaurant(opts.restaurantId, Events.BILL_UPDATED, { billId: String(bill._id), paymentPending: true });
  return payment.toObject();
}

export async function markPaymentSucceeded(opts: {
  providerOrderId?: string;
  paymentId?: string;
  providerPaymentId?: string;
  /** The UTR a person read off their own statement before they said the money arrived. */
  utr?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const query = opts.paymentId ? { _id: opts.paymentId } : { providerOrderId: opts.providerOrderId };
  const payment = await PaymentModel.findOne(query);
  if (!payment) return { ok: false, message: 'Payment reference not found' };
  if (payment.status === 'SUCCEEDED') return { ok: true, message: 'Already settled' };

  payment.status = 'SUCCEEDED';
  payment.verifiedAt = new Date();
  if (opts.providerPaymentId) payment.providerPaymentId = opts.providerPaymentId;
  if (opts.utr) payment.transactionId = opts.utr;
  await payment.save();

  await settleBill(payment.billId.toString(), payment.restaurantId.toString(), payment._id.toString(), {
    userId: null,
    role: 'SYSTEM',
    name: 'Payment gateway',
  });
  return { ok: true };
}

export async function markPaymentFailed(opts: { providerOrderId?: string; paymentId?: string; reason?: string }) {
  const query = opts.providerOrderId ? { providerOrderId: opts.providerOrderId } : { _id: opts.paymentId ?? '' };
  const payment = await PaymentModel.findOne(query);
  if (!payment) return { ok: false };
  if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') return { ok: true };
  payment.status = 'FAILED';
  payment.failureReason = opts.reason ?? 'Declined by gateway';
  await payment.save();
  emit.toRestaurant(String(payment.restaurantId), Events.PAYMENT_FAILED, {
    billId: String(payment.billId),
    reason: payment.failureReason,
  });
  emit.toCashier(String(payment.restaurantId), Events.PAYMENT_FAILED, {
    billId: String(payment.billId),
    reason: payment.failureReason,
  });
  return { ok: true };
}

/**
 * A guest says they paid. That is a claim, not money: the bill stays unpaid, the table stays
 * open, the kitchen hears nothing and the income figures do not move. What happens is that the
 * counter is told to look at a statement — and only a signed `payment.captured` afterwards can
 * settle anything.
 */
export async function markPaymentVerificationPending(opts: {
  providerOrderId?: string;
  paymentId?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const query = opts.paymentId ? { _id: opts.paymentId } : { providerOrderId: opts.providerOrderId };
  const payment = await PaymentModel.findOne(query);
  if (!payment) return { ok: false, message: 'Payment reference not found' };
  if (payment.status === 'SUCCEEDED') return { ok: true, message: 'Already settled' };

  if (payment.status !== 'VERIFICATION_PENDING') {
    payment.status = 'VERIFICATION_PENDING';
    await payment.save();
  }

  const bill = await BillModel.findById(payment.billId)
    .select('billNumber grandTotal tableNumber restaurantId tableSessionId')
    .lean();
  const restaurantId = String(payment.restaurantId);
  const payload = {
    paymentId: String(payment._id),
    billId: String(payment.billId),
    billNumber: bill?.billNumber ?? '',
    amount: payment.amount,
    method: payment.method,
    provider: payment.provider,
  };
  emit.toCashier(restaurantId, Events.PAYMENT_CLAIMED, payload);
  emit.toRestaurant(restaurantId, Events.PAYMENT_CLAIMED, payload);
  // The guest's own screen is the one place that must not go quiet after they tap "I've paid".
  if (bill?.tableSessionId) {
    const session = await TableSessionModel.findById(bill.tableSessionId).select('publicToken').lean();
    if (session) {
      emit.toSession(session.publicToken, Events.PAYMENT_CLAIMED, {
        billNumber: payload.billNumber,
        amount: payload.amount,
        state: 'CHECKING',
      });
    }
  }
  await notifyRoles(restaurantId, ['CASHIER', 'OWNER', 'MANAGER'], {
    type: 'PAYMENT_CLAIMED',
    title: `${bill?.billNumber ?? 'A bill'} claims a UPI payment`,
    body: `₹${payment.amount.toFixed(2)}${bill?.tableNumber ? ` · Table ${bill.tableNumber}` : ''} — check the statement before marking it paid`,
    entityType: 'Payment',
    entityId: String(payment._id),
  });
  await recordAudit({
    restaurantId,
    actorId: null,
    actorName: 'Payment service',
    action: 'payment.claimed',
    entityType: 'Payment',
    entityId: String(payment._id),
    metadata: { billNumber: bill?.billNumber ?? '', amount: payment.amount },
  });
  return { ok: true, message: 'Claim recorded' };
}

async function settleBill(billId: string, restaurantId: string, paymentId: string, actor: Actor) {
  const bill = await BillModel.findOneAndUpdate(
    { _id: billId, paymentStatus: 'UNPAID' },
    { status: 'PAID', paymentStatus: 'PAID', paidAt: new Date() },
    { new: true },
  );
  if (!bill) return;

  for (const orderId of bill.orderIds) {
    const order = await OrderModel.findOne({ _id: orderId, restaurantId });
    if (!order) continue;
    order.paymentStatus = 'PAID';
    if (order.status !== 'COMPLETED' && order.status !== 'CANCELLED') {
      await order.save();
      await transitionOrder(restaurantId, String(order._id), 'COMPLETED', actor, { system: true });
    } else {
      await order.save();
    }
  }

  const payment = await PaymentModel.findById(paymentId).lean();

  if (bill.tableSessionId) {
    await closeSession(bill.tableSessionId);
    // The money has been counted, so the calls that asked for it are answered. Left open, a
    // phantom "collect ₹990" ticket sits in the counter queue for the rest of the shift.
    const answered = await CustomerRequestModel.updateMany(
      {
        restaurantId,
        tableSessionId: bill.tableSessionId,
        type: { $in: ['BILL', 'CASH_PAYMENT'] },
        status: { $ne: 'DONE' },
      },
      { status: 'DONE', handledAt: new Date(), handledByUserId: actor.userId },
    );
    if (answered.modifiedCount) emit.toRestaurant(restaurantId, Events.REQUEST_UPDATED, { tableSessionId: String(bill.tableSessionId) });
    const session = await TableSessionModel.findById(bill.tableSessionId).select('publicToken').lean();
    if (session) {
      emit.toSession(session.publicToken, Events.BILL_PAID, {
        billId: String(bill._id),
        billNumber: bill.billNumber,
        grandTotal: bill.grandTotal,
        method: payment?.method ?? 'CASH',
      });
    }
  }

  emit.toRestaurant(restaurantId, Events.BILL_PAID, {
    billId: String(bill._id),
    billNumber: bill.billNumber,
    grandTotal: bill.grandTotal,
    method: payment?.method ?? 'CASH',
  });
  emit.toCashier(restaurantId, Events.BILL_PAID, { billId: String(bill._id), billNumber: bill.billNumber });
  await notifyRoles(restaurantId, ['OWNER', 'MANAGER'], {
    type: 'PAYMENT_SUCCEEDED',
    title: `Payment received · ₹${bill.grandTotal.toFixed(2)}`,
    body: `${bill.billNumber}${bill.tableNumber ? ` · Table ${bill.tableNumber}` : ''} · ${payment?.method ?? 'CASH'}`,
    entityType: 'Bill',
    entityId: String(bill._id),
  });
}

export async function refundPayment(opts: {
  restaurantId: string;
  paymentId: string;
  amount: number;
  reason: string;
  actor: Actor;
}) {
  const payment = await PaymentModel.findOne({ _id: opts.paymentId, restaurantId: opts.restaurantId });
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED') {
    throw ApiError.conflict('Only captured payments can be refunded');
  }
  const refunded = round2(payment.refunds.reduce((s, r) => s + r.amount, 0));
  const remaining = round2(payment.amount - refunded);
  if (opts.amount <= 0 || opts.amount > remaining) {
    throw ApiError.badRequest(`You can refund up to ₹${remaining.toFixed(2)}`);
  }

  let providerRefundId: string | null = null;
  if (payment.provider !== 'CASH') {
    const gateway = gatewayFor(payment.provider);
    if (gateway && payment.providerPaymentId) {
      try {
        providerRefundId = (await gateway.refund({
          providerPaymentId: payment.providerPaymentId,
          amount: opts.amount,
          reason: opts.reason,
        })).providerRefundId;
      } catch (err) {
        console.error('[refund] gateway refund failed, recording locally', err);
      }
    }
  }

  payment.refunds.push({
    amount: opts.amount,
    reason: opts.reason,
    byUserId: opts.actor.userId as unknown as Types.ObjectId,
    at: new Date(),
    providerRefundId,
  });
  const fullyRefunded = round2(refunded + opts.amount) >= payment.amount;
  payment.status = fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  await payment.save();

  if (fullyRefunded) {
    await BillModel.updateOne(
      { _id: payment.billId, restaurantId: opts.restaurantId },
      { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
    );
    await OrderModel.updateMany({ _id: { $in: payment.orderIds } }, { paymentStatus: 'REFUNDED' });
  }

  emit.toRestaurant(opts.restaurantId, Events.PAYMENT_REFUNDED, {
    paymentId: String(payment._id),
    amount: opts.amount,
    fullyRefunded,
  });
  await recordAudit({
    restaurantId: opts.restaurantId,
    actorId: opts.actor.userId,
    actorName: opts.actor.name,
    action: 'payment.refunded',
    entityType: 'Payment',
    entityId: String(payment._id),
    metadata: { amount: opts.amount, reason: opts.reason, fullyRefunded, providerRefundId },
  });
  return payment.toObject();
}

export async function markBillPrinted(restaurantId: string, billId: string) {
  const bill = await BillModel.findOneAndUpdate(
    { _id: billId, restaurantId },
    { $inc: { printCount: 1 }, lastPrintedAt: new Date() },
    { new: true },
  ).lean();
  if (!bill) throw ApiError.notFound('Bill not found');
  return bill;
}

/** Safe public digital bill view — no internal identifiers beyond the token. */
export async function publicBillView(publicToken: string) {
  const bill = await BillModel.findOne({ publicToken }).lean();
  if (!bill) throw ApiError.notFound('Bill not found');
  const [orders, session, restaurant] = await Promise.all([
    OrderModel.find({ _id: { $in: bill.orderIds } }).lean(),
    bill.tableSessionId ? TableSessionModel.findById(bill.tableSessionId).select('publicToken').lean() : Promise.resolve(null),
    RestaurantModel.findById(bill.restaurantId).select('name branding').lean(),
  ]);
  const items = orders.flatMap((order) =>
    order.items.map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price,
      isVeg: item.isVeg ?? true,
      addons: item.addons.map((a) => ({ name: a.name, price: a.price })),
      lineTotal: item.lineTotal,
    })),
  );
  return {
    billNumber: bill.billNumber,
    tableNumber: bill.tableNumber,
    customerName: bill.customerName,
    status: bill.status,
    paymentStatus: bill.paymentStatus,
    subtotal: bill.subtotal,
    discountAmount: bill.discountAmount,
    serviceCharge: bill.serviceCharge,
    taxTotal: bill.taxTotal,
    roundOff: bill.roundOff,
    grandTotal: bill.grandTotal,
    taxBreakup: bill.taxBreakup,
    issuedAt: bill.issuedAt,
    paidAt: bill.paidAt,
    merchant: restaurant
      ? { name: restaurant.name, logoUrl: restaurant.branding?.logoUrl ?? '' }
      : null,
    /** Lets the guest phone join its own realtime room and see the paid stamp arrive. */
    sessionToken: session?.publicToken ?? null,
    items,
    pay:
      bill.paymentStatus === 'UNPAID'
        ? await payViewFor(bill, { raise: false })
        : null,
  };
}
