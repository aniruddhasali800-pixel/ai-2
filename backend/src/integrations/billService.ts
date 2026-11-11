import { env } from '../config/env';
import { hmacHex, randomToken } from '../utils/tokens';

/**
 * Client for the bill service (`bill/`), which owns the payee UPI ID, the guest's pay page,
 * the verification queue and the income figures.
 *
 * Every call is signed with the shared secret over `METHOD /path . timestamp . nonce . body`,
 * the same canonical the service verifies — so a signature taken for one bill cannot be pointed
 * at another, and the payee address never travels in a header an access log would keep.
 */
export interface BillIntent {
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
  externalBillId: string | null;
  utr: string | null;
  paidAt: string | null;
  verifiedByName: string | null;
  payeeReadable: boolean;
}

export interface BillStaffActor {
  role: 'OWNER' | 'MANAGER' | 'CASHIER';
  name: string;
  id?: string | null;
}

export class BillServiceError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'BillServiceError';
  }
}

/**
 * Null when the pairing is incomplete: a base URL with no secret could only ever be spoofed.
 * Inbound verification uses `billServiceSecret` alone — a callback needs no base URL.
 */
export function billServiceConfig(): { base: string; secret: string; key: string } | null {
  const base = env.BILL_SERVICE_BASE_URL?.replace(/\/+$/, '');
  const secret = env.BILL_SERVICE_SHARED_SECRET;
  if (!base || !secret) return null;
  return { base, secret, key: env.BILL_SERVICE_KEY };
}

export function billServiceSecret(): string | null {
  return env.BILL_SERVICE_SHARED_SECRET ?? null;
}

export function billServiceEnabled(): boolean {
  return billServiceConfig() !== null;
}

export function signRequest(secret: string, method: string, pathname: string, body: string, timestamp: string, nonce: string): string {
  return hmacHex(secret, `${method.toUpperCase()} ${pathname}.${timestamp}.${nonce}.${body}`);
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown): Promise<T> {
  const config = billServiceConfig();
  if (!config) throw new BillServiceError(null, 'The bill service is not configured');

  const body = payload === undefined ? '' : JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomToken(12);
  const url = new URL(path, `${config.base}/`);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-pay-key': config.key,
        'x-pay-timestamp': timestamp,
        'x-pay-nonce': nonce,
        'x-pay-signature': signRequest(config.secret, method, url.pathname, body, timestamp, nonce),
      },
      body: method === 'GET' ? undefined : body,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    throw new BillServiceError(null, error instanceof Error ? error.message : 'The bill service did not answer');
  }

  const parsed = (await res.json().catch(() => ({}))) as T & { ok?: boolean; message?: string };
  if (!res.ok || parsed.ok === false) {
    throw new BillServiceError(res.status, parsed.message ?? `The bill service replied ${res.status}`);
  }
  return parsed;
}

export interface NewBillIntent {
  externalBillId: string;
  externalBillNumber: string;
  externalRestaurantId?: string | null;
  externalTableNumber?: string | null;
  customerLabel: string;
  amountRupees: number;
  items?: { name: string; quantity: number; unitPriceRupees: number }[];
  note?: string | null;
}

/** Idempotent on the bill id: re-issuing a bill reuses the request, so a printed QR keeps working. */
export async function createBillIntent(input: NewBillIntent): Promise<{ intent: BillIntent; reused: boolean }> {
  const res = await call<{ ok: boolean; reused: boolean; intent: BillIntent }>('POST', '/api/v1/intents', input);
  return { intent: res.intent, reused: res.reused };
}

export function readBillIntent(ref: string): Promise<{ ok: boolean; intent: BillIntent }> {
  return call('GET', `/api/v1/intents/${encodeURIComponent(ref)}`);
}

export function claimBillIntent(ref: string, actor: BillStaffActor): Promise<{ ok: boolean; intent: BillIntent }> {
  return call('POST', `/api/v1/intents/${encodeURIComponent(ref)}/claim`, { token: ref, actor });
}

export function settleBillIntent(
  ref: string,
  actor: BillStaffActor,
  opts: { utr?: string; outcome?: 'PAID' | 'FAILED'; reason?: string },
): Promise<{ ok: boolean; intent: BillIntent }> {
  return call('POST', `/api/v1/intents/${encodeURIComponent(ref)}/settle`, { ...opts, actor });
}

/**
 * Takes a QR out of circulation because the money arrived another way. A manager closing one is
 * counter bookkeeping, not a payment decision, so the bill service's CASHIER role (its "person at
 * the counter") is what the request carries — the name still says who did it. Confirming a UPI
 * payment is never relayed with a borrowed role.
 */
export async function closeBillIntent(
  ref: string,
  actor: { role: string; name: string },
  reason: string,
): Promise<BillIntent | null> {
  const relay: BillStaffActor = {
    role: actor.role === 'OWNER' ? 'OWNER' : 'CASHIER',
    name: `${actor.name} · ${actor.role}`.slice(0, 60),
  };
  const res = await call<{ ok: boolean; intent: BillIntent }>('POST', `/api/v1/intents/${encodeURIComponent(ref)}/cancel`, {
    reason,
    actor: relay,
  });
  return res.intent ?? null;
}

export interface BillQueue {
  awaitingVerification: BillIntent[];
  open: BillIntent[];
}

export function readQueue(): Promise<BillQueue> {
  return call<{ ok: boolean } & BillQueue>('GET', '/api/v1/queue');
}

export interface BillIncome {
  collectedPaise: number;
  count: number;
  awaitingVerification: { amountPaise: number; count: number };
  openRequests: { amountPaise: number; count: number };
  failedOrCancelled: { amountPaise: number; count: number };
  days: { day: string; amountPaise: number; count: number }[];
  bySource: { source: string; amountPaise: number; count: number }[];
  byVerifier: { name: string; amountPaise: number; count: number }[];
}

export function readIncome(days: number): Promise<{ ok: boolean; income: BillIncome }> {
  return call('GET', `/api/v1/income?days=${encodeURIComponent(String(days))}`);
}

export interface BillPayee {
  businessName: string;
  payeeName: string;
  payeeMasked: string;
  currency: string;
  notesPrefix: string;
  enabled: boolean;
}

export function readPayee(): Promise<{ ok: boolean; settings: BillPayee }> {
  return call('GET', '/api/v1/settings/payee');
}

/** Relayed as the acting Sizzle role: only an OWNER reaches this, and the service checks it again. */
export function savePayee(
  actor: BillStaffActor,
  values: { vpa: string; payeeName: string; businessName?: string; enabled?: boolean },
): Promise<{ ok: boolean; settings: BillPayee }> {
  return call('PATCH', '/api/v1/settings/payee', { ...values, actor });
}
