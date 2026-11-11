import { db } from './db';
import { Paise, rupeeString } from './money';
import { currentPayee, settingsView } from './settings';
import { paymentProvider } from './payments/registry';
import { randomToken } from './crypto';
import { notifySizzle, type CallbackResult } from './sizzle';
import {
  assertTransition,
  isTerminal,
  orderStatusFor,
  type ActorType,
  type OrderStatus,
  type PaymentStatus,
} from './payments/status';

/**
 * Payment intents for this service. A Sizzle bill becomes one intent, keyed by the bill id,
 * so a retried bill creation can never open a second QR for the same table.
 */

export interface BillIntentInput {
  externalBillId: string;
  externalBillNumber: string;
  externalRestaurantId?: string | null;
  externalTableNumber?: string | null;
  customerLabel: string;
  /** Rupees, as Sizzle stores money. Converted to paise here, once. */
  amountRupees: number;
  items?: { name: string; quantity: number; unitPriceRupees: number }[];
  note?: string | null;
}

async function loadIntent(where: { id?: string; token?: string; externalBillId?: string }) {
  return db.order.findFirst({
    where,
    include: { customer: true, items: true, verifiedBy: true, paymentEvents: { orderBy: { createdAt: 'desc' }, take: 12 } },
  });
}

export type IntentRecord = NonNullable<Awaited<ReturnType<typeof loadIntent>>>;

export interface IntentView {
  id: string;
  code: string;
  token: string;
  payUrl: string;
  status: string;
  paymentStatus: PaymentStatus;
  amountPaise: number;
  amountRupees: number;
  currency: string;
  upiUri: string;
  qrDataUrl: string;
  payeeVpaMasked: string;
  /** The frozen, public payee address — what a customer must be able to read and copy. */
  payeeVpa: string;
  payeeName: string;
  note: string;
  transactionRef: string;
  customerLabel: string;
  source: string;
  externalBillId: string | null;
  externalBillNumber: string | null;
  tableNumber: string | null;
  items: { name: string; quantity: number; lineTotalPaise: number }[];
  utr: string | null;
  paidAt: Date | null;
  verifiedByName: string | null;
  updatedAt: Date;
  payeeReadable: boolean;
}

function publicBase(): string {
  return (process.env.PUBLIC_URL ?? 'http://localhost:3100').replace(/\/$/, '');
}

export function intentTokenUrl(token: string): string {
  return `${publicBase()}/pay/${token}`;
}

/** Renders the QR from the payee frozen on this intent, so a later settings change cannot
 *  repoint a bill the guest is already looking at. */
export async function intentView(record: IntentRecord): Promise<IntentView> {
  const settings = await settingsView();
  const frozenVpa = record.upiIdUsed ?? '';
  const adapter = paymentProvider(record.paymentMethod);
  const readable = Boolean(adapter && frozenVpa);
  const created = adapter
    ? await adapter
        .create({
          amountPaise: record.totalInPaise,
          vpa: frozenVpa,
          payeeName: settings.payeeName,
          note: record.note ?? `Bill ${record.orderId}`,
          transactionRef: record.orderId,
        })
        .catch(() => null)
    : null;

  return {
    id: record.id,
    code: record.orderId,
    token: record.token,
    payUrl: intentTokenUrl(record.token),
    status: record.status,
    paymentStatus: record.paymentStatus as PaymentStatus,
    amountPaise: record.totalInPaise,
    amountRupees: record.totalInPaise / 100,
    currency: record.currency,
    upiUri: created?.upiUri ?? '',
    qrDataUrl: created?.qrDataUrl ?? '',
    payeeVpaMasked: created?.payeeVpaMasked ?? settings.payeeMasked,
    payeeVpa: frozenVpa,
    payeeName: created?.payeeName ?? settings.payeeName,
    note: record.note ?? `Bill ${record.orderId}`,
    transactionRef: record.orderId,
    customerLabel: record.customer.label,
    source: record.source,
    externalBillId: record.externalBillId,
    externalBillNumber: record.externalBillNumber,
    tableNumber: record.externalTableNumber,
    items: record.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      lineTotalPaise: item.lineTotalInPaise,
    })),
    utr: record.paymentReference,
    paidAt: record.paidAt,
    verifiedByName: record.verifiedBy?.name ?? null,
    updatedAt: record.updatedAt,
    payeeReadable: readable,
  };
}

export function findIntentById(id: string): Promise<IntentRecord | null> {
  return loadIntent({ id });
}

export function findIntentByToken(token: string): Promise<IntentRecord | null> {
  return loadIntent({ token });
}

export function findIntentByBill(externalBillId: string): Promise<IntentRecord | null> {
  return loadIntent({ externalBillId });
}

/** Resolve an intent by its id, its human code, or a Sizzle bill id — whichever a caller has. */
export async function findIntentAny(ref: string): Promise<IntentRecord | null> {
  return (await findIntentById(ref)) ?? (await findIntentByBill(ref)) ?? (await loadIntent({ token: ref }));
}

export interface CreatedIntent {
  record: IntentRecord;
  reused: boolean;
  view: IntentView;
}

export async function createBillIntent(input: BillIntentInput): Promise<CreatedIntent> {
  if (!input.externalBillId?.trim()) throw new Error('A bill id is required');
  const totalPaise = Paise(input.amountRupees);
  if (totalPaise <= 0) throw new Error('A bill of nothing to pay cannot be collected');

  const existing = await findIntentByBill(input.externalBillId);
  if (existing && isTerminal(existing.paymentStatus as PaymentStatus)) {
    return { record: existing, reused: true, view: await intentView(existing) };
  }

  const payee = await currentPayee();
  if (!payee) throw new PayeeNotConfiguredError();

  const settings = await settingsView();
  const note = input.note?.trim() || `${settings.notesPrefix} ${input.externalBillNumber}`;
  const items = (input.items ?? []).map((item) => {
    const unit = Paise(item.unitPriceRupees);
    const quantity = Math.max(1, Math.round(item.quantity));
    return { name: item.name.slice(0, 80), unit, quantity, line: unit * quantity };
  });

  const data = {
    source: 'SIZZLE',
    externalBillId: input.externalBillId,
    externalBillNumber: input.externalBillNumber,
    externalRestaurantId: input.externalRestaurantId ?? null,
    externalTableNumber: input.externalTableNumber ?? null,
    paymentMethod: 'UPI_DIRECT',
    paymentStatus: 'PENDING',
    status: 'AWAITING_PAYMENT',
    currency: settings.currency,
    totalInPaise: totalPaise,
    subtotalInPaise: items.length ? items.reduce((sum, item) => sum + item.line, 0) : totalPaise,
    upiIdUsed: payee.vpa,
    note: note.slice(0, 60),
  };

  if (existing) {
    // The bill was re-issued (or its total moved) — keep the token so a printed QR still works.
    const record = await db.order.update({
      where: { id: existing.id },
      data: { ...data, subtotalInPaise: data.subtotalInPaise },
      include: { customer: true, items: true, verifiedBy: true },
    });
    await syncItems(record.id, items);
    await db.customer.update({ where: { id: existing.customerId }, data: { label: input.customerLabel.slice(0, 80) } });
    await event(record.id, 'AMOUNT_SYNCED', 'SYSTEM', existing.paymentStatus, record.paymentStatus, {
      detail: `${rupeeString(existing.totalInPaise)} -> ${rupeeString(totalPaise)}`,
    });
    const withRelations = (await findIntentById(record.id))!;
    return { record: withRelations, reused: true, view: await intentView(withRelations) };
  }

  const customer = await db.customer.create({ data: { label: input.customerLabel.slice(0, 80) } });
  const created = await db.order.create({
    data: {
      ...data,
      orderId: input.externalBillNumber || `PAY-${randomToken(5).toUpperCase()}`,
      token: randomToken(16),
      customerId: customer.id,
    },
  });
  await syncItems(created.id, items);
  await event(created.id, 'INTENT_CREATED', 'SYSTEM', null, 'PENDING', { detail: input.externalBillNumber });
  const record = (await findIntentById(created.id))!;
  return { record, reused: false, view: await intentView(record) };
}

async function syncItems(orderId: string, items: { name: string; unit: number; quantity: number; line: number }[]) {
  if (!items.length) return;
  await db.orderItem.deleteMany({ where: { orderId } });
  await db.orderItem.createMany({
    data: items.map((item) => ({
      orderId,
      name: item.name,
      unitPriceInPaise: item.unit,
      quantity: item.quantity,
      lineTotalInPaise: item.line,
    })),
  });
}

export class PayeeNotConfiguredError extends Error {
  constructor() {
    super('No payee UPI ID is configured yet — the owner sets it in Payment settings.');
    this.name = 'PayeeNotConfiguredError';
  }
}

async function event(
  orderId: string,
  type: string,
  actorType: ActorType | 'SYSTEM',
  fromStatus: string | null,
  toStatus: string | null,
  extra?: { actorId?: string | null; reference?: string | null; detail?: string | null },
): Promise<void> {
  await db.paymentEvent.create({
    data: {
      orderId,
      type,
      actorType,
      fromStatus,
      toStatus,
      actorId: extra?.actorId ?? null,
      reference: extra?.reference ?? null,
      detail: extra?.detail ?? null,
    },
  });
}

export interface TransitionInput {
  ref: string;
  to: PaymentStatus;
  actor: ActorType;
  /**
   * A row of this service's User table. Sizzle-relayed actions pass the id the relay route
   * mirrored the actor under, so a payment confirmed over there is still nameable here.
   */
  actorId?: string | null;
  actorName?: string | null;
  /** Bank reference (UTR). Required by the state machine for PAID. */
  reference?: string | null;
  reason?: string | null;
  detail?: string | null;
}

export interface TransitionResult {
  view: IntentView;
  record: IntentRecord;
  callback: CallbackResult | 'not_applicable';
}

export class TransitionError extends Error {}

/** Audit names that read as what happened, not as the enum value with a prefix glued on. */
const EVENT_NAME: Record<PaymentStatus, string> = {
  PENDING: 'PAYMENT_PENDING',
  PAYMENT_VERIFICATION_PENDING: 'CLAIM_RAISED',
  PAID: 'PAYMENT_PAID',
  FAILED: 'PAYMENT_FAILED',
  CANCELLED: 'PAYMENT_CANCELLED',
};

export async function transitionPayment(input: TransitionInput): Promise<TransitionResult> {
  const record = await findIntentAny(input.ref);
  if (!record) throw new TransitionError('This payment request no longer exists');

  const from = record.paymentStatus as PaymentStatus;
  const adapter = paymentProvider(record.paymentMethod);
  if (input.actor === 'PROVIDER' && adapter && !adapter.canSettle) {
    throw new TransitionError(`${adapter.label} cannot confirm a payment on its own word`);
  }
  assertTransition(from, input.to, input.actor, input.reference);

  const nextOrderStatus = orderStatusFor(input.to, record.status as OrderStatus);
  const data = {
    paymentStatus: input.to,
    status: nextOrderStatus,
    paymentReference: input.reference?.trim() || record.paymentReference,
    paidAt: input.to === 'PAID' ? new Date() : record.paidAt,
    verifiedById: input.to === 'PAID' ? (input.actorId ?? record.verifiedById) : record.verifiedById,
    note:
      input.to === 'FAILED' && input.reason
        ? `${record.note ?? ''} · ${input.reason}`.slice(0, 60)
        : record.note,
  };

  // Compare-and-swap on the status we read: two staff verifying one claim cannot both win.
  const swapped = await db.order.updateMany({ where: { id: record.id, paymentStatus: from }, data });
  if (swapped.count !== 1) throw new TransitionError('This payment was changed by someone else just now — reload it');

  await event(record.id, EVENT_NAME[input.to], input.actor, from, input.to, {
    actorId: input.actorId ?? null,
    reference: input.reference ?? null,
    detail:
      [input.detail, input.reason, input.actorName ? `by ${input.actorName}` : null]
        .filter(Boolean)
        .join(' · ') || null,
  });

  const updated = (await findIntentById(record.id))!;
  const view = await intentView(updated);

  // Cancellation was Sizzle's own decision, so there is nothing to tell it.
  const event_ = input.to === 'CANCELLED' ? null : eventForStatus(input.to);
  if (!event_) return { view, record: updated, callback: 'not_applicable' };

  const callback = await notifySizzle({
    event: event_,
    providerOrderId: updated.id,
    providerPaymentId: updated.orderId,
    amountPaise: updated.totalInPaise,
    utr: updated.paymentReference,
    reason: input.reason ?? null,
    billNumber: updated.externalBillNumber,
  });
  await event(
    record.id,
    callback.ok ? 'SIZZLE_SYNCED' : 'SIZZLE_SYNC_FAILED',
    'SYSTEM',
    input.to,
    input.to,
    { detail: callback.message },
  );
  const withEvent = (await findIntentById(record.id))!;
  return { view: await intentView(withEvent), record: withEvent, callback };
}

function eventForStatus(to: PaymentStatus): 'payment.captured' | 'payment.failed' | 'payment.verification_pending' | null {
  if (to === 'PAYMENT_VERIFICATION_PENDING') return 'payment.verification_pending';
  if (to === 'PAID') return 'payment.captured';
  if (to === 'FAILED') return 'payment.failed';
  return null;
}

export interface StaffRef {
  id: string | null;
  name: string | null;
}

/** The customer's own claim. Rides the same state machine as staff actions. */
export function claimByToken(token: string): Promise<TransitionResult> {
  return transitionPayment({ ref: token, to: 'PAYMENT_VERIFICATION_PENDING', actor: 'CUSTOMER' });
}

export function settleByStaff(ref: string, utr: string, staff: StaffRef): Promise<TransitionResult> {
  return transitionPayment({ ref, to: 'PAID', actor: 'STAFF', actorId: staff.id, actorName: staff.name, reference: utr });
}

export function rejectByStaff(ref: string, reason: string, staff: StaffRef): Promise<TransitionResult> {
  return transitionPayment({ ref, to: 'FAILED', actor: 'STAFF', actorId: staff.id, actorName: staff.name, reason });
}

export function cancelIntent(
  ref: string,
  actor: ActorType,
  opts?: { staff?: StaffRef; reason?: string | null },
): Promise<TransitionResult> {
  return transitionPayment({
    ref,
    to: 'CANCELLED',
    actor,
    actorId: opts?.staff?.id ?? null,
    actorName: opts?.staff?.name ?? null,
    reason: opts?.reason ?? null,
  });
}

/** Cancel straight from a bill id, for Sizzle settling the same bill by cash. */
export async function cancelByBill(externalBillId: string, reason: string): Promise<IntentView | null> {
  const record = await findIntentByBill(externalBillId);
  if (!record || isTerminal(record.paymentStatus as PaymentStatus)) return record ? await intentView(record) : null;
  const result = await cancelIntent(record.id, 'STAFF', { staff: { id: null, name: 'Sizzle counter' }, reason });
  return result.view;
}

export const QUEUE_STATUSES: PaymentStatus[] = ['PENDING', 'PAYMENT_VERIFICATION_PENDING'];

export async function claimQueue() {
  const records = await db.order.findMany({
    where: { paymentStatus: 'PAYMENT_VERIFICATION_PENDING' },
    include: { customer: true, items: true, verifiedBy: true, paymentEvents: { orderBy: { createdAt: 'desc' }, take: 8 } },
    orderBy: { updatedAt: 'asc' },
    take: 60,
  });
  return Promise.all(records.map(intentView));
}

export async function openQueue() {
  const records = await db.order.findMany({
    where: { paymentStatus: { in: QUEUE_STATUSES } },
    include: { customer: true, items: true, verifiedBy: true, paymentEvents: { orderBy: { createdAt: 'desc' }, take: 8 } },
    orderBy: { updatedAt: 'asc' },
    take: 80,
  });
  return Promise.all(records.map(intentView));
}
