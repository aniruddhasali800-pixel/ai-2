import type { Fulfilment, OrderStatus } from './types';

const KEY = 'sizzle.app.tracked';

export interface TrackedOrder {
  token: string;
  orderNumber: string;
  status: OrderStatus;
  fulfilment: Fulfilment;
  at: string;
}

/**
 * The tracking link is the only credential a guest holds, so the app keeps the last
 * few of them locally — losing a chat message should not lose the order.
 */
export function listTracked(): TrackedOrder[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as TrackedOrder[]) : [];
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t?.token === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberTracked(order: TrackedOrder) {
  const next = [order, ...listTracked().filter((t) => t.token !== order.token)].slice(0, 8);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode, full quota, nothing worth crashing an order over.
  }
}

export function forgetTracked(token: string) {
  localStorage.setItem(KEY, JSON.stringify(listTracked().filter((t) => t.token !== token)));
}
