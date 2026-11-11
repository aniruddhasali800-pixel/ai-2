/**
 * The one place that decides what a payment is allowed to become, and who may say so.
 *
 * Direct UPI gives this service nothing to verify against, so no customer action can
 * produce PAID — only staff (with their bank statement) or a real provider can.
 */
export const PAYMENT_STATUSES = [
  'PENDING',
  'PAYMENT_VERIFICATION_PENDING',
  'PAID',
  'FAILED',
  'CANCELLED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = ['AWAITING_PAYMENT', 'IN_KITCHEN', 'READY', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTOR_TYPES = ['CUSTOMER', 'STAFF', 'PROVIDER', 'SYSTEM'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

type Rule = { to: PaymentStatus; actors: ActorType[]; requiresReference?: boolean };

const TRANSITIONS: Record<PaymentStatus, Rule[]> = {
  PENDING: [
    { to: 'PAYMENT_VERIFICATION_PENDING', actors: ['CUSTOMER', 'STAFF'] },
    { to: 'PAID', actors: ['STAFF', 'PROVIDER'], requiresReference: true },
    { to: 'FAILED', actors: ['STAFF', 'PROVIDER'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'STAFF'] },
  ],
  PAYMENT_VERIFICATION_PENDING: [
    // A re-claim is allowed: the guest may tap the button twice while the app reloads.
    { to: 'PAYMENT_VERIFICATION_PENDING', actors: ['CUSTOMER', 'STAFF'] },
    { to: 'PAID', actors: ['STAFF', 'PROVIDER'], requiresReference: true },
    { to: 'FAILED', actors: ['STAFF', 'PROVIDER'] },
    { to: 'CANCELLED', actors: ['STAFF'] },
  ],
  PAID: [],
  FAILED: [],
  CANCELLED: [],
};

export class StatusError extends Error {}

export function allowedTransitions(from: PaymentStatus): Rule[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: PaymentStatus, to: PaymentStatus, actor: ActorType): boolean {
  return allowedTransitions(from).some((rule) => rule.to === to && rule.actors.includes(actor));
}

/**
 * A provider actor may only settle if its adapter can actually confirm money moving
 * (`canSettle`). UPI-direct claims arrive as PROVIDER callbacks from our own dashboard,
 * which is a staff action relayed — so settle() passes STAFF.
 */
export function assertTransition(
  from: PaymentStatus,
  to: PaymentStatus,
  actor: ActorType,
  reference?: string | null,
): void {
  const rule = allowedTransitions(from).find((candidate) => candidate.to === to);
  if (!rule) throw new StatusError(`Cannot move a payment from ${from} to ${to}`);
  if (!rule.actors.includes(actor)) {
    throw new StatusError(`${actor} is not allowed to move a payment from ${from} to ${to}`);
  }
  if (rule.requiresReference && !reference?.trim()) {
    throw new StatusError('A bank reference (UTR) is required before a payment can be marked paid');
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return allowedTransitions(status).length === 0;
}

/** What the guest is told. Never "successful" until a human with a statement agrees. */
export const CUSTOMER_COPY: Record<PaymentStatus, { headline: string; detail: string }> = {
  PENDING: {
    headline: 'Waiting for payment',
    detail: 'Scan the QR or open your UPI app, pay the exact amount, then tell us.',
  },
  PAYMENT_VERIFICATION_PENDING: {
    headline: 'Payment submitted. Payment verification pending.',
    detail: 'We have told the counter. This confirms your claim, not the money — the counter matches it against their UPI statement.',
  },
  PAID: { headline: 'Payment received', detail: 'Thank you. The counter has confirmed your transfer.' },
  FAILED: { headline: 'Payment could not be confirmed', detail: 'The counter checked and could not find this transfer. Please ask them before paying again.' },
  CANCELLED: { headline: 'This bill is closed', detail: 'The payment request was cancelled. Nothing is owed through this QR.' },
};

/** The lifecycle axis is separate from the payment axis; only a PAID payment opens the kitchen. */
export function orderStatusFor(paymentStatus: PaymentStatus, current: OrderStatus): OrderStatus {
  if (paymentStatus === 'PAID') return current === 'AWAITING_PAYMENT' ? 'IN_KITCHEN' : current;
  if (paymentStatus === 'CANCELLED') return 'CANCELLED';
  return current;
}
