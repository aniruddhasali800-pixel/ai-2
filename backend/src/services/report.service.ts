import { Types } from 'mongoose';
import {
  BillModel,
  BookingModel,
  InventoryItemModel,
  OrderModel,
  PaymentModel,
  TableModel,
  TableSessionModel,
} from '../models';
import { round2 } from '../utils/money';
import type { OrderSource } from '../types/constants';

const TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type Granularity = 'day' | 'week' | 'month' | 'year';

const DATE_FORMATS: Record<Granularity, string> = {
  day: '%Y-%m-%d',
  week: '%G-W%V',
  month: '%Y-%m',
  year: '%Y',
};

export function startOfIstDay(date = new Date()): Date {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function resolveRange(fromRaw?: string, toRaw?: string, defaultDays = 7): { from: Date; to: Date } {
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : addDays(startOfIstDay(to), -(defaultDays - 1));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { from: addDays(startOfIstDay(), -(defaultDays - 1)), to: new Date() };
  }
  return { from, to };
}

type Channel = 'DINE_IN' | 'DELIVERY' | 'TAKEAWAY';

function channelExpression() {
  return {
    $switch: {
      branches: [
        {
          case: { $in: ['$source', ['DINE_IN_QR', 'DINE_IN_WAITER', 'CASHIER']] },
          then: 'DINE_IN',
        },
        { case: { $in: ['$source', ['SWIGGY', 'ZOMATO', 'WEBSITE']] }, then: 'DELIVERY' },
      ],
      default: 'TAKEAWAY',
    },
  };
}

/** Only settled, non-refunded orders count as revenue. */
function revenueMatch(restaurantId: string, from: Date, to: Date) {
  return {
    restaurantId: new Types.ObjectId(restaurantId),
    status: 'COMPLETED' as const,
    paymentStatus: 'PAID' as const,
    completedAt: { $gte: from, $lte: to },
  };
}

interface SalesBucket {
  _id: string;
  orders: number;
  revenue: number;
  tax: number;
  discount: number;
  serviceCharge: number;
}

export interface SalesReport {
  range: { from: string; to: string; granularity: Granularity };
  totals: {
    revenue: number;
    orders: number;
    avgOrderValue: number;
    tax: number;
    discount: number;
    serviceCharge: number;
  };
  series: { label: string; revenue: number; orders: number }[];
  channels: { channel: Channel; revenue: number; orders: number }[];
  sources: { source: OrderSource; revenue: number; orders: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
}

export async function salesReport(
  restaurantId: string,
  opts: { from: Date; to: Date; granularity?: Granularity },
): Promise<SalesReport> {
  const granularity = opts.granularity ?? 'day';
  const match = revenueMatch(restaurantId, opts.from, opts.to);

  const [series, channels, sources, hourly] = await Promise.all([
    OrderModel.aggregate<SalesBucket>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: DATE_FORMATS[granularity], date: '$completedAt', timezone: TZ } },
          orders: { $sum: 1 },
          revenue: { $sum: '$grandTotal' },
          tax: { $sum: '$taxTotal' },
          discount: { $sum: '$discountAmount' },
          serviceCharge: { $sum: '$serviceCharge' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    OrderModel.aggregate<{ _id: Channel; revenue: number; orders: number }>([
      { $match: match },
      { $group: { _id: channelExpression() as never, revenue: { $sum: '$grandTotal' }, orders: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
    ]),
    OrderModel.aggregate<{ _id: OrderSource; revenue: number; orders: number }>([
      { $match: match },
      { $group: { _id: '$source', revenue: { $sum: '$grandTotal' }, orders: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
    ]),
    OrderModel.aggregate<{ _id: number; orders: number; revenue: number }>([
      { $match: match },
      {
        $group: {
          _id: { $hour: { date: '$completedAt', timezone: TZ } },
          orders: { $sum: 1 },
          revenue: { $sum: '$grandTotal' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const totalRevenue = series.reduce((sum, bucket) => sum + bucket.revenue, 0);
  const totalOrders = series.reduce((sum, bucket) => sum + bucket.orders, 0);

  const filled = granularity === 'day' ? fillDailySeries(series, opts.from, opts.to) : series;
  const hourlyFilled = Array.from({ length: 24 }, (_, hour) => {
    const found = hourly.find((h) => h._id === hour);
    return { hour, orders: found?.orders ?? 0, revenue: round2(found?.revenue ?? 0) };
  });

  return {
    range: { from: opts.from.toISOString(), to: opts.to.toISOString(), granularity },
    totals: {
      revenue: round2(totalRevenue),
      orders: totalOrders,
      avgOrderValue: totalOrders ? round2(totalRevenue / totalOrders) : 0,
      tax: round2(series.reduce((s, b) => s + b.tax, 0)),
      discount: round2(series.reduce((s, b) => s + b.discount, 0)),
      serviceCharge: round2(series.reduce((s, b) => s + b.serviceCharge, 0)),
    },
    series: filled.map((b) => ({ label: b._id, revenue: round2(b.revenue), orders: b.orders })),
    channels: channels.map((c) => ({ channel: c._id, revenue: round2(c.revenue), orders: c.orders })),
    sources: sources.map((s) => ({ source: s._id, revenue: round2(s.revenue), orders: s.orders })),
    hourly: hourlyFilled,
  };
}

function fillDailySeries(buckets: SalesBucket[], from: Date, to: Date): SalesBucket[] {
  const byLabel = new Map(buckets.map((b) => [b._id, b]));
  const filled: SalesBucket[] = [];
  const cursor = startOfIstDay(from);
  const end = addDays(startOfIstDay(to), 1);
  let guard = 0;
  while (cursor < end && guard < 400) {
    const label = new Date(cursor.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    filled.push(
      byLabel.get(label) ?? { _id: label, orders: 0, revenue: 0, tax: 0, discount: 0, serviceCharge: 0 },
    );
    cursor.setTime(addDays(cursor, 1).getTime());
    guard += 1;
  }
  return filled;
}

export interface PaymentReport {
  range: { from: string; to: string };
  totals: { collected: number; refunded: number; net: number; count: number };
  byMethod: { method: string; amount: number; count: number }[];
  byProvider: { provider: string; amount: number; count: number }[];
  cashierPerformance: { userId: string; name: string; collected: number; count: number }[];
  /** Someone says they paid; nobody has read the statement yet. Claimed, never counted as income. */
  awaitingVerification: { amount: number; count: number };
}

export async function paymentReport(restaurantId: string, from: Date, to: Date): Promise<PaymentReport> {
  const rid = new Types.ObjectId(restaurantId);
  // Income is keyed on when the money was confirmed, not when the row was opened: a claim raised
  // on the 3rd and settled on the 4th belongs to the 4th.
  const base = { restaurantId: rid, status: 'SUCCEEDED' as const, verifiedAt: { $gte: from, $lte: to } };

  const [byMethod, byProvider, byCashier, refunds, awaiting] = await Promise.all([
    PaymentModel.aggregate<{ _id: string; amount: number; count: number }>([
      { $match: base },
      { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    PaymentModel.aggregate<{ _id: string; amount: number; count: number }>([
      { $match: base },
      { $group: { _id: '$provider', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    PaymentModel.aggregate<{
      _id: Types.ObjectId;
      collected: number;
      count: number;
      user: { name: string }[];
    }>([
      { $match: { ...base, collectedByUserId: { $ne: null } } },
      { $group: { _id: '$collectedByUserId', collected: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $sort: { collected: -1 } },
      { $limit: 25 },
    ]),
    PaymentModel.aggregate<{ _id: null; refunded: number }>([
      { $match: { restaurantId: rid, createdAt: { $gte: from, $lte: to } } },
      { $unwind: '$refunds' },
      { $group: { _id: null, refunded: { $sum: '$refunds.amount' } } },
    ]),
    PaymentModel.aggregate<{ _id: null; amount: number; count: number }>([
      { $match: { restaurantId: rid, status: 'VERIFICATION_PENDING' as const, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const collected = byMethod.reduce((sum, m) => sum + m.amount, 0);
  const refunded = refunds[0]?.refunded ?? 0;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      collected: round2(collected),
      refunded: round2(refunded),
      net: round2(collected - refunded),
      count: byMethod.reduce((sum, m) => sum + m.count, 0),
    },
    byMethod: byMethod.map((m) => ({ method: m._id, amount: round2(m.amount), count: m.count })),
    byProvider: byProvider.map((p) => ({ provider: p._id, amount: round2(p.amount), count: p.count })),
    cashierPerformance: byCashier.map((c) => ({
      userId: String(c._id),
      name: c.user[0]?.name ?? 'Unknown',
      collected: round2(c.collected),
      count: c.count,
    })),
    awaitingVerification: { amount: round2(awaiting[0]?.amount ?? 0), count: awaiting[0]?.count ?? 0 },
  };
}

export interface ProductReport {
  range: { from: string; to: string };
  topProducts: { productId: string | null; name: string; category: string; qty: number; revenue: number }[];
  categories: { category: string; qty: number; revenue: number }[];
  slowMovers: { productId: string | null; name: string; qty: number; revenue: number }[];
}

export async function productReport(restaurantId: string, from: Date, to: Date): Promise<ProductReport> {
  const rows = await OrderModel.aggregate<{
    _id: { productId: Types.ObjectId | null; name: string };
    qty: number;
    revenue: number;
    product: { categoryId: Types.ObjectId }[];
    category: { name: string }[];
  }>([
    { $match: revenueMatch(restaurantId, from, to) },
    { $unwind: '$items' },
    {
      $group: {
        _id: { productId: '$items.productId', name: '$items.name' },
        qty: { $sum: '$items.qty' },
        revenue: { $sum: '$items.lineTotal' },
      },
    },
    { $lookup: { from: 'products', localField: '_id.productId', foreignField: '_id', as: 'product' } },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'categories', localField: 'product.categoryId', foreignField: '_id', as: 'category' } },
  ]);

  const withCategory = rows.map((r) => ({
    productId: r._id.productId ? String(r._id.productId) : null,
    name: r._id.name,
    category: r.category[0]?.name ?? 'Uncategorised',
    qty: r.qty,
    revenue: round2(r.revenue),
  }));

  const byCategory = new Map<string, { qty: number; revenue: number }>();
  for (const row of withCategory) {
    const entry = byCategory.get(row.category) ?? { qty: 0, revenue: 0 };
    entry.qty += row.qty;
    entry.revenue += row.revenue;
    byCategory.set(row.category, entry);
  }

  const sorted = [...withCategory].sort((a, b) => b.revenue - a.revenue);
  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    topProducts: sorted.slice(0, 15),
    slowMovers: sorted.slice(-5).reverse(),
    categories: [...byCategory.entries()]
      .map(([category, v]) => ({ category, qty: v.qty, revenue: round2(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

export interface OperationsReport {
  range: { from: string; to: string };
  waiters: { userId: string; name: string; orders: number; revenue: number }[];
  occupancy: { date: string; sessions: number; guests: number; avgMinutes: number }[];
  tableStatus: { status: string; count: number }[];
  bookings: { status: string; count: number }[];
  taxBreakup: { label: string; percent: number; amount: number }[];
}

export async function operationsReport(restaurantId: string, from: Date, to: Date): Promise<OperationsReport> {
  const rid = new Types.ObjectId(restaurantId);

  const [waiters, occupancy, tableStatus, bookings, taxBreakup] = await Promise.all([
    OrderModel.aggregate<{ _id: Types.ObjectId; orders: number; revenue: number; user: { name: string }[] }>([
      { $match: { ...revenueMatch(restaurantId, from, to), waiterId: { $ne: null } } },
      { $group: { _id: '$waiterId', orders: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $sort: { revenue: -1 } },
    ]),
    TableSessionModel.aggregate<{ _id: string; sessions: number; guests: number; avgMs: number }>([
      {
        $match: {
          restaurantId: rid,
          openedAt: { $gte: from, $lte: to },
          status: 'CLOSED',
          closedAt: { $ne: null },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$openedAt', timezone: TZ } },
          sessions: { $sum: 1 },
          guests: { $sum: '$guestCount' },
          avgMs: { $avg: { $subtract: ['$closedAt', '$openedAt'] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    TableModel.aggregate<{ _id: string; count: number }>([
      { $match: { restaurantId: rid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    BookingModel.aggregate<{ _id: string; count: number }>([
      { $match: { restaurantId: rid, startAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    BillModel.aggregate<{ _id: { label: string; percent: number }; amount: number }>([
      {
        $match: {
          restaurantId: rid,
          status: { $ne: 'VOID' },
          createdAt: { $gte: from, $lte: to },
        },
      },
      { $unwind: '$taxBreakup' },
      { $group: { _id: { label: '$taxBreakup.label', percent: '$taxBreakup.percent' }, amount: { $sum: '$taxBreakup.amount' } } },
      { $sort: { amount: -1 } },
    ]),
  ]);

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    waiters: waiters.map((w) => ({
      userId: String(w._id),
      name: w.user[0]?.name ?? 'Unknown',
      orders: w.orders,
      revenue: round2(w.revenue),
    })),
    occupancy: occupancy.map((o) => ({
      date: o._id,
      sessions: o.sessions,
      guests: o.guests,
      avgMinutes: Math.round((o.avgMs ?? 0) / 60_000),
    })),
    tableStatus: tableStatus.map((t) => ({ status: t._id, count: t.count })),
    bookings: bookings.map((b) => ({ status: b._id, count: b.count })),
    taxBreakup: taxBreakup.map((t) => ({
      label: t._id.label,
      percent: t._id.percent,
      amount: round2(t.amount),
    })),
  };
}

export interface DashboardPayload {
  today: { revenue: number; orders: number; avgOrderValue: number; trendPct: number };
  yesterday: { revenue: number; orders: number };
  live: { activeOrders: number; unpaidBills: number; unpaidAmount: number; openSessions: number };
  tables: { status: string; count: number }[];
  lowStock: { count: number; items: { _id: string; name: string; stock: number; unit: string }[] };
  upcomingBookings: number;
  week: { label: string; revenue: number; orders: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  recentOrders: {
    _id: string;
    orderNumber: string;
    source: string;
    status: string;
    paymentStatus: string;
    grandTotal: number;
    customerName: string;
    createdAt: Date;
  }[];
}

export async function dashboard(restaurantId: string): Promise<DashboardPayload> {
  const rid = new Types.ObjectId(restaurantId);
  const todayStart = startOfIstDay();
  const tomorrowStart = addDays(todayStart, 1);
  const yesterdayStart = addDays(todayStart, -1);

  const dayTotals = (from: Date, to: Date) =>
    OrderModel.aggregate<{ _id: null; revenue: number; orders: number }>([
      { $match: revenueMatch(restaurantId, from, to) },
      { $group: { _id: null, revenue: { $sum: '$grandTotal' }, orders: { $sum: 1 } } },
    ]);

  const [todayAgg, yesterdayAgg, activeOrders, unpaid, openSessions, tables, lowStockItems, upcomingBookings, week, hourly, topItems, recentOrders] =
    await Promise.all([
      dayTotals(todayStart, tomorrowStart),
      dayTotals(yesterdayStart, todayStart),
      OrderModel.countDocuments({ restaurantId, status: { $in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'] } }),
      BillModel.aggregate<{ _id: null; count: number; amount: number }>([
        { $match: { restaurantId: rid, paymentStatus: 'UNPAID', status: 'ISSUED' } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$grandTotal' } } },
      ]),
      TableSessionModel.countDocuments({ restaurantId, status: { $ne: 'CLOSED' } }),
      TableModel.aggregate<{ _id: string; count: number }>([
        { $match: { restaurantId: rid } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      InventoryItemModel.find({
        restaurantId,
        isActive: true,
        $expr: { $lte: ['$stock', '$lowStockThreshold'] },
      })
        .select('name stock unit')
        .limit(10)
        .lean(),
      BookingModel.countDocuments({
        restaurantId,
        status: { $in: ['PENDING', 'CONFIRMED'] },
        startAt: { $gte: new Date(), $lte: addDays(new Date(), 1) },
      }),
      salesReport(restaurantId, { from: addDays(todayStart, -6), to: new Date(), granularity: 'day' }),
      OrderModel.aggregate<{ _id: number; orders: number; revenue: number }>([
        { $match: revenueMatch(restaurantId, todayStart, tomorrowStart) },
        { $group: { _id: { $hour: { date: '$completedAt', timezone: TZ } }, orders: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
        { $sort: { _id: 1 } },
      ]),
      OrderModel.aggregate<{ _id: string; qty: number; revenue: number }>([
        { $match: revenueMatch(restaurantId, todayStart, tomorrowStart) },
        { $unwind: '$items' },
        { $group: { _id: '$items.name', qty: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
        { $sort: { revenue: -1 } },
        { $limit: 6 },
      ]),
      OrderModel.find({ restaurantId })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('orderNumber source status paymentStatus grandTotal customerName createdAt')
        .lean(),
    ]);

  const todayRevenue = todayAgg[0]?.revenue ?? 0;
  const todayOrders = todayAgg[0]?.orders ?? 0;
  const yesterdayRevenue = yesterdayAgg[0]?.revenue ?? 0;

  return {
    today: {
      revenue: round2(todayRevenue),
      orders: todayOrders,
      avgOrderValue: todayOrders ? round2(todayRevenue / todayOrders) : 0,
      trendPct: yesterdayRevenue ? round2(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100) : 0,
    },
    yesterday: { revenue: round2(yesterdayRevenue), orders: yesterdayAgg[0]?.orders ?? 0 },
    live: {
      activeOrders,
      unpaidBills: unpaid[0]?.count ?? 0,
      unpaidAmount: round2(unpaid[0]?.amount ?? 0),
      openSessions,
    },
    tables: tables.map((t) => ({ status: t._id, count: t.count })),
    lowStock: {
      count: lowStockItems.length,
      items: lowStockItems.map((i) => ({
        _id: String(i._id),
        name: i.name,
        stock: i.stock,
        unit: i.unit,
      })),
    },
    upcomingBookings,
    week: week.series,
    hourly: Array.from({ length: 24 }, (_, hour) => {
      const found = hourly.find((h) => h._id === hour);
      return { hour, orders: found?.orders ?? 0, revenue: round2(found?.revenue ?? 0) };
    }),
    topItems: topItems.map((t) => ({ name: t._id, qty: t.qty, revenue: round2(t.revenue) })),
    recentOrders: recentOrders.map((o) => ({
      _id: String(o._id),
      orderNumber: o.orderNumber,
      source: o.source,
      status: o.status,
      paymentStatus: o.paymentStatus,
      grandTotal: o.grandTotal,
      customerName: o.customerName ?? '',
      createdAt: o.createdAt,
    })),
  };
}
