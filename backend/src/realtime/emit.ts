import { getIO, roomNames } from './socket';

/** Canonical realtime event names shared with the frontend. */
export const Events = {
  ORDER_CREATED: 'order.created',
  ORDER_ACCEPTED: 'order.accepted',
  ORDER_PREPARING: 'order.preparing',
  ORDER_READY: 'order.ready',
  ORDER_SERVED: 'order.served',
  ORDER_COMPLETED: 'order.completed',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_UPDATED: 'order.updated',
  REQUEST_CREATED: 'customer.requested',
  REQUEST_UPDATED: 'request.updated',
  BILL_REQUESTED: 'bill.requested',
  BILL_CREATED: 'bill.created',
  BILL_UPDATED: 'bill.updated',
  BILL_PAID: 'bill.paid',
  PAYMENT_CLAIMED: 'payment.claimed',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  BOOKING_CREATED: 'booking.created',
  BOOKING_UPDATED: 'booking.updated',
  BOOKING_REMINDER: 'booking.reminder',
  TABLE_UPDATED: 'table.updated',
  TABLE_CLEANED: 'table.cleaned',
  TABLE_AVAILABLE: 'table.available',
  SESSION_UPDATED: 'session.updated',
  MENU_UPDATED: 'menu.updated',
  SETTINGS_UPDATED: 'settings.updated',
  DAY_CLOSE_UPDATED: 'dayclose.closed',
  INVENTORY_UPDATED: 'inventory.updated',
  INVENTORY_LOW_STOCK: 'inventory.low_stock',
  NOTIFICATION: 'notification:new',
  DELIVERY_ORDER: 'delivery.order',
  STAFF_UPDATED: 'staff.updated',
} as const;

export type EventName = (typeof Events)[keyof typeof Events];

const ROOM = {
  restaurant: (id: string) => roomNames.restaurant(id),
  kitchen: (id: string) => roomNames.kitchen(id),
  cashier: (id: string) => roomNames.cashier(id),
  waiter: (userId: string) => roomNames.waiter(userId),
  user: (userId: string) => roomNames.user(userId),
  session: (token: string) => roomNames.session(token),
  order: (token: string) => roomNames.order(token),
};

function safeEmit(room: string, event: string, payload: unknown) {
  try {
    getIO().to(room).emit(event, payload);
  } catch {
    // Realtime is optional outside a running server (scripts, tests).
  }
}

export const emit = {
  toRestaurant(restaurantId: string, event: string, payload?: unknown) {
    safeEmit(ROOM.restaurant(restaurantId), event, payload ?? {});
  },
  toKitchen(restaurantId: string, event: string, payload?: unknown) {
    safeEmit(ROOM.kitchen(restaurantId), event, payload ?? {});
    safeEmit(ROOM.restaurant(restaurantId), event, payload ?? {});
  },
  toCashier(restaurantId: string, event: string, payload?: unknown) {
    safeEmit(ROOM.cashier(restaurantId), event, payload ?? {});
    safeEmit(ROOM.restaurant(restaurantId), event, payload ?? {});
  },
  toWaiter(userId: string, event: string, payload?: unknown) {
    safeEmit(ROOM.waiter(userId), event, payload ?? {});
  },
  toUser(userId: string, event: string, payload?: unknown) {
    safeEmit(ROOM.user(userId), event, payload ?? {});
  },
  toSession(sessionToken: string, event: string, payload?: unknown) {
    safeEmit(ROOM.session(sessionToken), event, payload ?? {});
  },
  /** One guest following one ticket home. Silently does nothing without a tracking token. */
  toOrder(trackingToken: string | null | undefined, event: string, payload?: unknown) {
    if (!trackingToken) return;
    safeEmit(ROOM.order(trackingToken), event, payload ?? {});
  },
};
