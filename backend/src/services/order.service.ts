import { Types } from 'mongoose';
import { OrderModel, ProductModel, RestaurantModel, TableModel, TableSessionModel, nextSeq, type Order as OrderRow } from '../models';
import {
  priceOrderItems,
  computeTotals,
  externalLines,
  type DiscountInput,
  type IncomingItem,
  type PricedLine,
} from './pricing.service';
import { emit, Events } from '../realtime/emit';
import { ApiError } from '../utils/httpError';
import { randomToken } from '../utils/tokens';
import { serializeTable, setTableStatus, takeTableForWaiter, touchSession } from './table.service';
import { notifyRoles } from './notification.service';
import { deductForOrder } from './inventory.service';
import { recordAudit } from './audit.service';
import {
  ORDER_TRANSITIONS,
  type OrderSource,
  type OrderStatus,
  type Role,
} from '../types/constants';

/** Punches that belong to a party at a table, so they can join that table's running fire. */
const MERGED_SOURCES: OrderSource[] = ['DINE_IN_QR', 'DINE_IN_WAITER'];

const SOURCE_PREFIX: Record<OrderSource, string> = {  DINE_IN_QR: 'D',
  DINE_IN_WAITER: 'D',
  CASHIER: 'D',
  SWIGGY: 'S',
  ZOMATO: 'Z',
  WEBSITE: 'W',
  PHONE: 'P',
  OTHER: 'O',
  CUSTOMER_APP: 'A',
};

/** Sources a guest can reach without a staff member typing the order in. */
const PUBLIC_SOURCES: OrderSource[] = ['DINE_IN_QR', 'WEBSITE', 'CUSTOMER_APP'];

/**
 * The copy a guest sees depends on how the food travels: the same READY ticket is
 * "on the pass" for a table and "ready for the rider" for a delivery.
 */
export function fulfilmentWord(fulfilment: string, kind: 'ready' | 'handed' | 'closed'): string {
  const table = { ready: 'is on the pass', handed: 'was served', closed: 'is closed' };
  const pickup = { ready: 'is ready for pickup', handed: 'has been collected', closed: 'is collected' };
  const delivery = { ready: 'is packed, waiting for a rider', handed: 'is out for delivery', closed: 'is delivered' };
  const map = fulfilment === 'PICKUP' ? pickup : fulfilment === 'DELIVERY' ? delivery : table;
  return map[kind];
}

export function fulfilmentLabel(fulfilment: string): string {
  const map: Record<string, string> = { DINE_IN: 'Dine-in', PICKUP: 'Pickup', DELIVERY: 'Home delivery' };
  return map[fulfilment] ?? 'Order';
}

export function paymentModeLabel(mode: string): string {
  const map: Record<string, string> = { UPI: 'pay by UPI', CARD: 'card on checkout', CASH_ON_DELIVERY: 'cash on delivery' };
  return map[mode] ?? 'payment at the counter';
}

/** Only the guest's own slice of the ticket crosses the wire into their tracking room. */
function ticketForGuest(order: OrderRow) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    fulfilment: order.fulfilment,
    paymentMode: order.paymentMode,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    taxTotal: order.taxTotal,
    serviceCharge: order.serviceCharge,
    grandTotal: order.grandTotal,
    placedAt: order.placedAt,
    acceptedAt: order.acceptedAt,
    readyAt: order.readyAt,
    servedAt: order.servedAt,
    completedAt: order.completedAt,
    riderName: order.riderName ?? '',
    statusHistory: order.statusHistory,
  };
}

export function statusEventName(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    PLACED: Events.ORDER_CREATED,
    ACCEPTED: Events.ORDER_ACCEPTED,
    PREPARING: Events.ORDER_PREPARING,
    READY: Events.ORDER_READY,
    SERVED: Events.ORDER_SERVED,
    COMPLETED: Events.ORDER_COMPLETED,
    CANCELLED: Events.ORDER_CANCELLED,
  };
  return map[status];
}

/** Roles allowed to move an order into a given status. */
const TRANSITION_ROLES: Record<OrderStatus, Role[]> = {
  PLACED: [],
  ACCEPTED: ['KITCHEN', 'MANAGER', 'OWNER'],
  PREPARING: ['KITCHEN', 'MANAGER', 'OWNER'],
  READY: ['KITCHEN', 'MANAGER', 'OWNER'],
  SERVED: ['WAITER', 'MANAGER', 'OWNER', 'CASHIER'],
  COMPLETED: ['CASHIER', 'WAITER', 'MANAGER', 'OWNER'],
  CANCELLED: ['CASHIER', 'MANAGER', 'OWNER'],
};

interface Actor {
  userId: string | null;
  role: Role | 'SYSTEM';
  name: string;
}

export interface CreateOrderInput {
  restaurantId: string;
  source: OrderSource;
  actor?: Actor;
  fulfilment?: 'DINE_IN' | 'PICKUP' | 'DELIVERY';
  paymentMode?: '' | 'UPI' | 'CARD' | 'CASH_ON_DELIVERY';
  trackingToken?: string;
  riderName?: string;
  tableId?: string | null;
  tableSessionId?: string | null;
  waiterId?: string | null;
  cashierId?: string | null;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerCity?: string;
  notes?: string;
  items?: IncomingItem[];
  externalItems?: { name: string; price: number; qty: number; notes?: string }[];
  externalOrderId?: string;
  integrationMeta?: Record<string, unknown>;
  discount?: DiscountInput;
  billId?: string | null;
  status?: OrderStatus;
  placedAt?: Date;
  acceptedAt?: Date | null;
  completedAt?: Date | null;
  paymentStatus?: 'UNPAID' | 'PAID' | 'REFUNDED';
}

/**
 * Punches aimed at one table are queued behind each other.
 *
 * Joining the running fire is a read-then-write, and now that every waiter may work every table
 * two phones can tap Send in the same breath. Left alone each one reads "no open ticket" and the
 * table is ordered twice again. The queue is per table session, so one busy party never holds up
 * the rest of the floor.
 */
const punchQueues = new Map<string, Promise<unknown>>();

export function createOrder(input: CreateOrderInput) {
  if (!input.tableSessionId) return placeOrder(input);
  const key = String(input.tableSessionId);
  const tail = (punchQueues.get(key) ?? Promise.resolve()).then(() => placeOrder(input));
  const settled = tail.then(
    () => undefined,
    () => undefined,
  );
  punchQueues.set(key, settled);
  void settled.then(() => {
    if (punchQueues.get(key) === settled) punchQueues.delete(key);
  });
  return tail;
}

async function placeOrder(input: CreateOrderInput) {
  const restaurant = await RestaurantModel.findById(input.restaurantId).lean();
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  // ── Every waiter works every table ──────────────────────────────────
  // Nobody is locked out of a punch. A table with no name on it yet takes the waiter who starts
  // work on it, purely so the floor can show who to ask — the claim is conditional because two
  // phones can tap at the same moment, and the label should be one name rather than a race result.
  if (input.tableId && input.actor?.role === 'WAITER' && input.actor.userId) {
    await takeTableForWaiter({
      restaurantId: input.restaurantId,
      tableId: String(input.tableId),
      waiterId: input.actor.userId,
    });
  }

  // ── One fire per table until the kitchen starts ─────────────────────
  // A second Send on a party the pass has not begun is the same order grown, not a new ticket:
  // a table that has been punched twice is two kitchens, two totals and a guest asking which
  // plate is theirs. Once cooking has started the next punch is a real second round.
  if (
    input.tableSessionId &&
    MERGED_SOURCES.includes(input.source) &&
    !input.discount &&
    !input.externalItems?.length &&
    input.items?.length
  ) {
    const fire = await OrderModel.findOne({
      restaurantId: input.restaurantId,
      tableSessionId: input.tableSessionId,
      status: { $in: ['PLACED', 'ACCEPTED'] },
      billId: null,
    })
      .sort({ placedAt: -1 })
      .lean();
    if (fire) {
      const merged = await addItemsToOrder(
        input.restaurantId,
        String(fire._id),
        input.items,
        input.actor ?? { userId: null, role: 'SYSTEM', name: 'Guest order' },
      );
      return { ...merged, merged: true };
    }
  }

  const isPublicFacing = PUBLIC_SOURCES.includes(input.source);
  if (isPublicFacing && !restaurant.settings?.acceptingOrders) {
    throw ApiError.conflict('This restaurant is not accepting orders right now');
  }

  let lines: PricedLine[];
  let discount = input.discount;
  if (input.externalItems?.length) {
    lines = externalLines(input.externalItems, restaurant.taxPercent);
    discount = undefined;
  } else {
    lines = (
      await priceOrderItems({
        restaurantId: input.restaurantId,
        items: input.items ?? [],
        discount: input.discount,
        serviceChargePercent: restaurant.serviceChargePercent ?? 0,
        defaultTaxPercent: restaurant.taxPercent ?? 5,
      })
    ).items;
  }

  const totals = computeTotals({
    lines,
    discount,
    serviceChargePercent: input.externalItems?.length ? 0 : restaurant.serviceChargePercent ?? 0,
  });

  // One running sequence per restaurant — a daily reset would collide with the
  // unique (restaurantId, orderNumber) index as soon as the clock rolls over.
  const seq = await nextSeq(`order:${input.restaurantId}`);
  const orderNumber = `${SOURCE_PREFIX[input.source] ?? 'O'}-${String(seq).padStart(3, '0')}`;

  const autoAccept = restaurant.settings?.autoAcceptOrders ?? false;
  const status: OrderStatus = input.status ?? (autoAccept ? 'ACCEPTED' : 'PLACED');

  const now = new Date();
  const order = await OrderModel.create({
    restaurantId: input.restaurantId,
    orderNumber,
    source: input.source,
    fulfilment: input.fulfilment ?? 'DINE_IN',
    paymentMode: input.paymentMode ?? '',
    trackingToken: input.trackingToken,
    riderName: input.riderName ?? '',
    tableId: input.tableId ?? null,
    tableSessionId: input.tableSessionId ?? null,
    waiterId: input.waiterId ?? null,
    cashierId: input.cashierId ?? null,
    customerName: input.customerName ?? '',
    customerPhone: input.customerPhone ?? '',
    customerAddress: input.customerAddress ?? '',
    customerCity: input.customerCity ?? '',
    externalOrderId: input.externalOrderId ?? null,
    integrationMeta: input.integrationMeta ?? null,
    items: lines,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    serviceCharge: totals.serviceCharge,
    discountAmount: totals.discountAmount,
    discountNote: discount?.note ?? '',
    grandTotal: totals.grandTotal,
    status,
    paymentStatus: input.paymentStatus ?? 'UNPAID',
    billId: input.billId ?? null,
    notes: input.notes ?? '',
    placedAt: input.placedAt ?? now,
    acceptedAt: input.acceptedAt ?? (status === 'ACCEPTED' ? now : null),
    completedAt: input.completedAt ?? null,
    statusHistory: [
      { status: 'PLACED', at: input.placedAt ?? now, byUserId: input.actor?.userId ?? null },
      ...(status === 'ACCEPTED'
        ? [{ status: 'ACCEPTED' as OrderStatus, at: now, byUserId: input.actor?.userId ?? null }]
        : []),
    ],
  });

  const payload = order.toObject();
  const restaurantId = input.restaurantId;

  emit.toKitchen(restaurantId, Events.ORDER_CREATED, payload);
  emit.toRestaurant(restaurantId, Events.ORDER_UPDATED, payload);

  if (order.tableSessionId) {
    await touchSession(order.tableSessionId);
    const table = await TableModel.findOne({ _id: order.tableId, restaurantId }).lean();
    if (table && table.status !== 'BILL_REQUESTED' && table.status !== 'PAYMENT_PENDING') {
      await setTableStatus(table._id, 'ORDERING');
    }
    const session = await TableSessionModel.findById(order.tableSessionId).select('publicToken tableId').lean();
    if (session) {
      emit.toSession(session.publicToken, Events.ORDER_CREATED, payload);
    }
    const title = `New order ${orderNumber}`;
    // Every waiter works every table, so the whole floor is told a ticket is open — a guest or a
    // colleague asking after it gets an answer from whoever is nearest.
    await notifyRoles(restaurantId, ['WAITER'], {
      type: 'ORDER_CREATED',
      title,
      body: `Table ${table?.number ?? ''} · ${lines.length} item(s)`,
      entityType: 'Order',
      entityId: String(order._id),
    });
  }

  if (['SWIGGY', 'ZOMATO', 'WEBSITE'].includes(input.source)) {
    emit.toRestaurant(restaurantId, Events.DELIVERY_ORDER, payload);
    await notifyRoles(restaurantId, ['OWNER', 'MANAGER'], {
      type: 'DELIVERY_ORDER',
      title: `${input.source === 'WEBSITE' ? 'Website' : input.source.charAt(0) + input.source.slice(1).toLowerCase()} order ${orderNumber}`,
      body: `${input.customerName || 'Customer'} · ₹${totals.grandTotal.toFixed(2)}`,
      entityType: 'Order',
      entityId: String(order._id),
    });
  }

  if (input.source === 'CUSTOMER_APP') {
    emit.toRestaurant(restaurantId, Events.DELIVERY_ORDER, payload);
    emit.toOrder(order.trackingToken, Events.ORDER_CREATED, ticketForGuest(order.toObject()));
    // The app ticket has no waiter carrying it in, so the floor, the counter and the
    // owner all hear it at once — whoever is standing nearest picks it up.
    await notifyRoles(restaurantId, ['OWNER', 'MANAGER', 'WAITER', 'CASHIER'], {
      type: 'DELIVERY_ORDER',
      title: `App order ${orderNumber} · ${fulfilmentLabel(order.fulfilment)}`,
      body: `${input.customerName || 'Guest'} · ₹${totals.grandTotal.toFixed(2)} · ${paymentModeLabel(order.paymentMode)}`,
      entityType: 'Order',
      entityId: String(order._id),
    });
  }

  return { ...order.toObject(), merged: false };
}

export async function getOrder(restaurantId: string, orderId: string) {
  const order = await OrderModel.findOne({ _id: orderId, restaurantId }).lean();
  if (!order) throw ApiError.notFound('Order not found');
  return withItemImages(order);
}

/**
 * A ticket freezes the name and the price, but the photo is part of the live menu —
 * the owner uploads it after the order exists and every open ticket should show it.
 */
async function withItemImages<T extends object>(order: T): Promise<T> {
  const items = (order as { items?: { productId?: unknown }[] }).items ?? [];
  const ids = [...new Set(items.map((i) => String(i.productId ?? '')).filter((id) => id.length === 24))];
  if (!ids.length) return order;
  const products = await ProductModel.find({ _id: { $in: ids } }).select('imageUrl').lean();
  const imageById = new Map(products.map((p) => [String(p._id), p.imageUrl ?? '']));
  return { ...order, items: items.map((i) => ({ ...i, imageUrl: imageById.get(String(i.productId ?? '')) ?? '' })) };
}

export interface ListOrdersFilter {
  restaurantId: string;
  status?: OrderStatus | OrderStatus[];
  source?: OrderSource | OrderSource[];
  tableId?: string;
  sessionId?: string;
  activeOnly?: boolean;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listOrders(filter: ListOrdersFilter) {
  const query: Record<string, unknown> = { restaurantId: filter.restaurantId };
  if (filter.activeOnly) {
    query.status = { $in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'] };
  } else if (filter.status) {
    query.status = Array.isArray(filter.status) ? { $in: filter.status } : filter.status;
  }
  if (filter.source) {
    query.source = Array.isArray(filter.source) ? { $in: filter.source } : filter.source;
  }
  if (filter.tableId) query.tableId = filter.tableId;
  if (filter.sessionId) query.tableSessionId = filter.sessionId;
  if (filter.from || filter.to) {
    query.createdAt = {
      ...(filter.from ? { $gte: filter.from } : {}),
      ...(filter.to ? { $lte: filter.to } : {}),
    };
  }
  if (filter.search) {
    const rx = new RegExp(filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ orderNumber: rx }, { customerName: rx }, { customerPhone: rx }, { customerCity: rx }, { externalOrderId: rx }];
  }

  const page = Math.max(1, filter.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
  const [data, total] = await Promise.all([
    OrderModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    OrderModel.countDocuments(query),
  ]);
  return { data, total, page, limit };
}

export async function kitchenQueue(restaurantId: string) {
  const orders = await OrderModel.find({
    restaurantId,
    status: { $in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'] },
  })
    .sort({ placedAt: 1 })
    .limit(80)
    .lean();

  // The pass shouts a table number, so the ticket has to carry one — an order id
  // alone sends a cook walking the corridor guessing whose biryani this is.
  const tableIds = [...new Set(orders.map((o) => o.tableId).filter((id): id is Types.ObjectId => Boolean(id)))];
  const tables = tableIds.length ? await TableModel.find({ _id: { $in: tableIds } }).select('number').lean() : [];
  const numberById = new Map(tables.map((t) => [String(t._id), t.number]));
  return orders.map((order) => ({
    ...order,
    tableNumber: order.tableId ? numberById.get(String(order.tableId)) ?? '' : '',
  }));
}

export async function transitionOrder(
  restaurantId: string,
  orderId: string,
  next: OrderStatus,
  actor: Actor,
  opts: { system?: boolean; reason?: string; riderName?: string } = {},
) {
  const order = await OrderModel.findOne({ _id: orderId, restaurantId });
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status === next) return order.toObject();
  if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
    throw ApiError.conflict(`Order is already ${order.status.toLowerCase()}`);
  }
  // A settled bill closes out orders the kitchen never finished; every other path walks the state machine.
  const settlementClose =
    opts.system && next === 'COMPLETED' && ['PLACED', 'ACCEPTED', 'PREPARING'].includes(order.status as OrderStatus);
  if (!settlementClose && !ORDER_TRANSITIONS[order.status as OrderStatus].includes(next)) {
    throw ApiError.conflict(`Cannot move an order from ${order.status} to ${next}`);
  }
  if (!opts.system && !TRANSITION_ROLES[next].includes(actor.role as Role)) {
    throw ApiError.forbidden(`Your role cannot mark an order as ${next.toLowerCase()}`);
  }

  const now = new Date();
  order.status = next;
  order.statusHistory.push({ status: next, at: now, byUserId: (actor.userId ?? null) as unknown as Types.ObjectId });
  if (next === 'ACCEPTED') order.acceptedAt = now;
  if (next === 'READY') order.readyAt = now;
  if (next === 'SERVED') order.servedAt = now;
  if (next === 'COMPLETED') order.completedAt = now;
  if (next === 'CANCELLED') order.cancelReason = opts.reason ?? '';
  if (opts.riderName) order.riderName = opts.riderName;
  await order.save();

  const payload = order.toObject();
  emit.toKitchen(restaurantId, statusEventName(next), payload);
  emit.toRestaurant(restaurantId, Events.ORDER_UPDATED, payload);
  emit.toOrder(order.trackingToken, statusEventName(next), ticketForGuest(payload));

  if (order.source === 'CUSTOMER_APP' && ['READY', 'SERVED', 'COMPLETED'].includes(next)) {
    const kind = next === 'READY' ? 'ready' : next === 'SERVED' ? 'handed' : 'closed';
    await notifyRoles(restaurantId, next === 'READY' ? ['MANAGER', 'WAITER'] : ['MANAGER'], {
      type: next === 'READY' ? 'ORDER_READY' : 'SYSTEM',
      title: `App order ${order.orderNumber} ${fulfilmentWord(order.fulfilment, kind)}`,
      body: order.riderName ? `Rider: ${order.riderName}` : `${fulfilmentLabel(order.fulfilment)} · ₹${order.grandTotal}`,
      entityType: 'Order',
      entityId: String(order._id),
    });
    // Cash on delivery only closes when the counter has the money in the drawer.
    if (next === 'COMPLETED' && order.paymentMode === 'CASH_ON_DELIVERY' && order.paymentStatus !== 'PAID') {
      await notifyRoles(restaurantId, ['CASHIER'], {
        type: 'BILL_REQUESTED',
        title: `Collect ₹${order.grandTotal} for ${order.orderNumber}`,
        body: `${fulfilmentLabel(order.fulfilment)} was closed with cash still owed`,
        entityType: 'Order',
        entityId: String(order._id),
      });
    }
  }

  const session = order.tableSessionId
    ? await TableSessionModel.findById(order.tableSessionId).select('publicToken').lean()
    : null;
  if (session) emit.toSession(session.publicToken, statusEventName(next), payload);

  if (order.tableId) {
    const table = await TableModel.findOne({ _id: order.tableId, restaurantId }).lean();
    if (next === 'READY' && table && !['BILL_REQUESTED', 'PAYMENT_PENDING'].includes(table.status)) {
      await setTableStatus(table._id, 'FOOD_READY');
      const readyTitle = `Order ${order.orderNumber} is ready`;
      // The floor is open: any waiter runs the food to any table, so every waiter is rung rather
      // than only the name on the card.
      await notifyRoles(restaurantId, ['WAITER'], {
        type: 'ORDER_READY',
        title: readyTitle,
        body: `Pick up for table ${table.number}`,
        entityType: 'Order',
        entityId: String(order._id),
      });
      if (table.assignedWaiterId) {
        emit.toWaiter(String(table.assignedWaiterId), Events.ORDER_READY, payload);
      }
    }
    if (next === 'SERVED' && table) {
      const others = await OrderModel.countDocuments({
        tableSessionId: order.tableSessionId,
        status: { $in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'] },
        _id: { $ne: order._id },
      });
      if (others === 0 && !['BILL_REQUESTED', 'PAYMENT_PENDING'].includes(table.status)) {
        await setTableStatus(table._id, 'OCCUPIED');
      }
    }
    if (next === 'CANCELLED' && table) {
      const others = await OrderModel.countDocuments({
        tableSessionId: order.tableSessionId,
        status: { $nin: ['CANCELLED', 'COMPLETED'] },
        _id: { $ne: order._id },
      });
      if (others === 0 && !['BILL_REQUESTED', 'PAYMENT_PENDING'].includes(table.status)) {
        await setTableStatus(table._id, 'OCCUPIED');
      }
    }
  }

  if (next === 'COMPLETED') {
    await deductForOrder(String(order._id), restaurantId, actor.name || 'System');
  }

  if (next === 'CANCELLED') {
    await recordAudit({
      restaurantId,
      actorId: actor.userId,
      actorName: actor.name,
      action: 'order.cancelled',
      entityType: 'Order',
      entityId: String(order._id),
      metadata: { orderNumber: order.orderNumber, reason: opts.reason ?? '', amount: order.grandTotal },
    });
  }

  return payload;
}

export async function addItemsToOrder(
  restaurantId: string,
  orderId: string,
  items: IncomingItem[],
  actor: Actor,
) {
  const order = await OrderModel.findOne({ _id: orderId, restaurantId });
  if (!order) throw ApiError.notFound('Order not found');
  if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
    throw ApiError.conflict('You cannot add items to a closed order');
  }
  if (order.billId) throw ApiError.conflict('This order has already been billed');

  // ── Every waiter works every table ──────────────────────────────────
  if (actor.role === 'WAITER' && actor.userId && order.tableId) {
    await takeTableForWaiter({ restaurantId, tableId: String(order.tableId), waiterId: actor.userId });
  }

  const restaurant = await RestaurantModel.findById(restaurantId).lean();
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  const priced = await priceOrderItems({
    restaurantId,
    items,
    serviceChargePercent: 0,
    defaultTaxPercent: restaurant.taxPercent ?? 5,
  });

  const combined: PricedLine[] = [...(order.items as unknown as PricedLine[]), ...priced.items];
  const totals = computeTotals({
    lines: combined,
    discount: order.discountAmount > 0 ? { type: 'FLAT', value: order.discountAmount, note: order.discountNote } : undefined,
    serviceChargePercent: restaurant.serviceChargePercent ?? 0,
  });

  order.items = combined as never;
  order.subtotal = totals.subtotal;
  order.taxTotal = totals.taxTotal;
  order.serviceCharge = totals.serviceCharge;
  order.roundOff = 0;
  order.grandTotal = totals.grandTotal;
  await order.save();

  const payload = order.toObject();
  emit.toKitchen(restaurantId, Events.ORDER_UPDATED, payload);
  emit.toRestaurant(restaurantId, Events.ORDER_UPDATED, payload);
  if (order.tableSessionId) {
    const session = await TableSessionModel.findById(order.tableSessionId).select('publicToken').lean();
    if (session) emit.toSession(session.publicToken, Events.ORDER_UPDATED, payload);
    await touchSession(order.tableSessionId);
  }
  return payload;
}
