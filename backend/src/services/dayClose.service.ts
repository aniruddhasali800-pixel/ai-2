// The end-of-day close: one file per business day that holds everything the owner asks for at 8 pm —
// every sale, every bill, every order, the money split by method, the dishes that moved, what left the
// pantry, and yesterday's numbers sitting beside today's so the trend needs no second screen.
//
// It is written to the archive rather than a database because the archive *is* the database here: a
// closed day is a file a person can open in Explorer, keep a copy of, or email, and it never changes
// after the day is over.
import { Types } from 'mongoose';
import {
  BillModel,
  InventoryItemModel,
  InventoryTransactionModel,
  OrderModel,
  PaymentModel,
  RestaurantModel,
  TableModel,
  TableSessionModel,
  UserModel,
} from '../models';
import { folderForRestaurant, listArchiveFiles, readArchiveFile, writeArchiveFile } from '../store';
import { notifyRoles } from './notification.service';
import { round2 } from '../utils/money';
import {
  addDays,
  operationsReport,
  paymentReport,
  productReport,
  salesReport,
  startOfIstDay,
} from './report.service';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** A count that agrees with its own noun, since a notice is read by a person. */
function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

export interface DayWindow {
  /** The Indian calendar day the report covers, as `YYYY-MM-DD`. */
  date: string;
  from: Date;
  to: Date;
}

export interface DayCloseBill {
  billId: string;
  billNumber: string;
  issuedAt: string;
  tableNumber: string;
  customerName: string;
  orders: number;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountAmount: number;
  roundOff: number;
  grandTotal: number;
  status: string;
  paymentStatus: string;
  methods: string[];
  collected: number;
  paidAt: string | null;
  issuedBy: string;
}

export interface DayCloseOrder {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  completedAt: string | null;
  source: string;
  status: string;
  paymentStatus: string;
  channel: 'DINE_IN' | 'DELIVERY' | 'TAKEAWAY';
  tableNumber: string;
  waiter: string;
  items: number;
  quantity: number;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountAmount: number;
  grandTotal: number;
}

export interface DayCloseReport {
  kind: 'day-close';
  schema: 1;
  restaurant: { id: string; name: string; slug: string };
  date: string;
  window: { from: string; to: string };
  generatedAt: string;
  totals: {
    revenue: number;
    orders: number;
    avgOrderValue: number;
    covers: number;
    tax: number;
    serviceCharge: number;
    discount: number;
    collected: number;
    refunded: number;
    net: number;
    bills: number;
    unpaidBills: number;
    unpaidAmount: number;
    cancelledOrders: number;
  };
  versus: {
    date: string;
    revenue: number;
    orders: number;
    revenueDelta: number;
    revenueDeltaPct: number;
    ordersDelta: number;
    avgOrderValueDelta: number;
  };
  hourly: { hour: number; orders: number; revenue: number }[];
  channels: { channel: string; revenue: number; orders: number }[];
  sources: { source: string; revenue: number; orders: number }[];
  methods: { method: string; amount: number; count: number }[];
  providers: { provider: string; amount: number; count: number }[];
  awaitingVerification: { amount: number; count: number };
  cashierPerformance: { userId: string; name: string; collected: number; count: number }[];
  topProducts: { productId: string | null; name: string; category: string; qty: number; revenue: number }[];
  categories: { category: string; qty: number; revenue: number }[];
  slowMovers: { productId: string | null; name: string; qty: number; revenue: number }[];
  waiters: { userId: string; name: string; orders: number; revenue: number }[];
  occupancy: { date: string; sessions: number; guests: number; avgMinutes: number }[];
  taxBreakup: { label: string; percent: number; amount: number }[];
  bookings: { status: string; count: number }[];
  stock: {
    movements: { item: string; type: string; qty: number; unit: string; balanceAfter: number; at: string }[];
    used: { item: string; unit: string; qty: number }[];
    totals: { type: string; qty: number }[];
    low: { item: string; stock: number; unit: string; threshold: number }[];
  };
  bills: DayCloseBill[];
  orders: DayCloseOrder[];
}

/** The Indian calendar day an instant falls on, as the report names it. */
export function istDateLabel(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseIstDate(label: string): Date {
  const [yyyy, mm, dd] = label.split('-').map(Number);
  // Midnight in Kolkata is 18:30 UTC the evening before, so the day is cut by shifting the instant
  // rather than by reading the server clock — which is what the archive's day folders already do.
  return new Date(Date.UTC(yyyy, mm - 1, dd) - IST_OFFSET_MS);
}

/** The report window for one business day: midnight to midnight, Indian time. */
export function dayWindow(date: string | Date = new Date()): DayWindow {
  // A `YYYY-MM-DD` argument names the day itself, so noon in Kolkata is safely inside it; a Date
  // argument is an instant that has to be read back as the Indian day it falls on.
  const label = typeof date === 'string' ? date : istDateLabel(date);
  const from = parseIstDate(label);
  return { date: label, from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1) };
}

const DINE_IN: string[] = ['DINE_IN_QR', 'DINE_IN_WAITER', 'CASHIER'];
const DELIVERY: string[] = ['SWIGGY', 'ZOMATO', 'WEBSITE'];

function channelOf(source: string): 'DINE_IN' | 'DELIVERY' | 'TAKEAWAY' {
  if (DINE_IN.includes(source)) return 'DINE_IN';
  if (DELIVERY.includes(source)) return 'DELIVERY';
  return 'TAKEAWAY';
}

async function namesById(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((one): one is string => Boolean(one)))];
  if (!unique.length) return new Map();
  const people = await UserModel.find({ _id: { $in: unique.map((one) => new Types.ObjectId(one)) as never } })
    .select('_id name')
    .lean();
  return new Map(people.map((one) => [String(one._id), String(one.name)]));
}

/**
 * Builds the whole close from the day's records. The money aggregates come from the same report
 * functions the live dashboards use, so a closed day and a dashboard can never disagree.
 */
export async function buildDayClose(restaurantId: string, date: string | Date = new Date()): Promise<DayCloseReport> {
  const window = dayWindow(date);
  const previous = dayWindow(addDays(window.from, -1));
  const rid = new Types.ObjectId(restaurantId);

  const [restaurant, sales, payments, products, operations, orderRows, billRows, sessions, movements, items, tables] =
    await Promise.all([
      RestaurantModel.findById(restaurantId).lean(),
      salesReport(restaurantId, { from: window.from, to: window.to, granularity: 'day' }),
      paymentReport(restaurantId, window.from, window.to),
      productReport(restaurantId, window.from, window.to),
      operationsReport(restaurantId, window.from, window.to),
      OrderModel.find({ restaurantId: rid, placedAt: { $gte: window.from, $lte: window.to } })
        .sort({ placedAt: 1 })
        .lean(),
      BillModel.find({ restaurantId: rid, createdAt: { $gte: window.from, $lte: window.to } })
        .sort({ createdAt: 1 })
        .lean(),
      TableSessionModel.find({ restaurantId: rid, openedAt: { $gte: window.from, $lte: window.to } }).lean(),
      InventoryTransactionModel.find({ restaurantId: rid, createdAt: { $gte: window.from, $lte: window.to } })
        .sort({ createdAt: 1 })
        .lean(),
      InventoryItemModel.find({ restaurantId: rid }).lean(),
      TableModel.find({ restaurantId: rid }).lean(),
    ]);

  // Yesterday is compared through the same code path, not a stored number, so a corrected bill
  // rewrites both days the next time a close is generated.
  const yesterdaySales = await salesReport(restaurantId, {
    from: previous.from,
    to: previous.to,
    granularity: 'day',
  }).catch(() => null);

  const billIds = billRows.map((one) => String(one._id));
  const payRows = billIds.length
    ? await PaymentModel.find({ restaurantId: rid, billId: { $in: billIds.map((one) => new Types.ObjectId(one)) as never } }).lean()
    : [];
  const paidByBill = new Map<string, { methods: Set<string>; collected: number; paidAt: Date | null }>();
  for (const pay of payRows) {
    const row = paidByBill.get(String(pay.billId)) ?? { methods: new Set<string>(), collected: 0, paidAt: null };
    if (pay.status === 'SUCCEEDED') {
      row.methods.add(String(pay.method));
      row.collected += Number(pay.amount) || 0;
      row.paidAt = pay.verifiedAt ?? pay.createdAt ?? null;
    }
    paidByBill.set(String(pay.billId), row);
  }

  const waiterNames = await namesById(orderRows.map((one) => one.waiterId as string | null));
  const issuerNames = await namesById(billRows.map((one) => one.issuedByUserId as string | null));
  const itemNames = new Map(items.map((one) => [String(one._id), one]));
  const tableNumbers = new Map(tables.map((one) => [String(one._id), String(one.number)]));
  // A delivery order names no table; a dine-in one usually names the session rather than the table,
  // so the number is followed through whichever the ticket actually carries.
  const sessionTable = new Map(sessions.map((one) => [String(one._id), String(one.tableId)]));
  const tableNumberOf = (order: (typeof orderRows)[number]): string => {
    const direct = order.tableId ? tableNumbers.get(String(order.tableId)) : null;
    if (direct) return direct;
    const viaSession = order.tableSessionId ? sessionTable.get(String(order.tableSessionId)) : null;
    return (viaSession && tableNumbers.get(viaSession)) ?? '';
  };

  const orders: DayCloseOrder[] = orderRows.map((one) => ({
    orderId: String(one._id),
    orderNumber: one.orderNumber,
    placedAt: (one.placedAt ?? one.createdAt).toISOString(),
    completedAt: one.completedAt ? one.completedAt.toISOString() : null,
    source: one.source,
    status: one.status,
    paymentStatus: one.paymentStatus,
    channel: channelOf(one.source),
    tableNumber: tableNumberOf(one),
    waiter: one.waiterId ? waiterNames.get(String(one.waiterId)) ?? '' : '',
    items: one.items.length,
    quantity: one.items.reduce((sum, item) => sum + (item.qty || 0), 0),
    subtotal: round2(one.subtotal),
    taxTotal: round2(one.taxTotal),
    serviceCharge: round2(one.serviceCharge ?? 0),
    discountAmount: round2(one.discountAmount ?? 0),
    grandTotal: round2(one.grandTotal),
  }));

  const bills: DayCloseBill[] = billRows.map((one) => {
    const paid = paidByBill.get(String(one._id));
    return {
      billId: String(one._id),
      billNumber: one.billNumber,
      issuedAt: (one.issuedAt ?? one.createdAt).toISOString(),
      tableNumber: one.tableNumber ?? '',
      customerName: one.customerName ?? '',
      orders: one.orderIds.length,
      subtotal: round2(one.subtotal),
      taxTotal: round2(one.taxTotal),
      serviceCharge: round2(one.serviceCharge ?? 0),
      discountAmount: round2(one.discountAmount ?? 0),
      roundOff: round2(one.roundOff ?? 0),
      grandTotal: round2(one.grandTotal),
      status: one.status,
      paymentStatus: one.paymentStatus,
      methods: [...(paid?.methods ?? [])],
      collected: round2(paid?.collected ?? 0),
      paidAt: paid?.paidAt ? new Date(paid.paidAt).toISOString() : null,
      issuedBy: one.issuedByUserId ? issuerNames.get(String(one.issuedByUserId)) ?? '' : 'Guest requested',
    };
  });

  const unpaid = bills.filter((one) => one.paymentStatus !== 'PAID');
  // A DEDUCTION is the kitchen drawing stock for a recipe; WASTE and RECEIPT are the pantry's own
  // movements, and the close reports each separately so a leak is not mistaken for a busy service.
  const usedByItem = new Map<string, number>();
  for (const move of movements) {
    if (move.type !== 'DEDUCTION') continue;
    usedByItem.set(String(move.itemId), (usedByItem.get(String(move.itemId)) ?? 0) + (move.qty || 0));
  }
  const byType = new Map<string, number>();
  for (const move of movements) byType.set(move.type, (byType.get(move.type) ?? 0) + (move.qty || 0));

  const revenue = sales.totals.revenue;
  const before = yesterdaySales?.totals.revenue ?? 0;
  const beforeOrders = yesterdaySales?.totals.orders ?? 0;

  return {
    kind: 'day-close',
    schema: 1,
    restaurant: {
      id: restaurantId,
      name: String(restaurant?.name ?? ''),
      slug: String(restaurant?.slug ?? ''),
    },
    date: window.date,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    generatedAt: new Date().toISOString(),
    totals: {
      revenue,
      orders: sales.totals.orders,
      avgOrderValue: sales.totals.avgOrderValue,
      covers: sessions.reduce((sum, one) => sum + (one.guestCount || 0), 0),
      tax: sales.totals.tax,
      serviceCharge: sales.totals.serviceCharge,
      discount: sales.totals.discount,
      collected: payments.totals.collected,
      refunded: payments.totals.refunded,
      net: payments.totals.net,
      bills: bills.length,
      unpaidBills: unpaid.length,
      unpaidAmount: round2(unpaid.reduce((sum, one) => sum + one.grandTotal, 0)),
      cancelledOrders: orders.filter((one) => one.status === 'CANCELLED').length,
    },
    versus: {
      date: previous.date,
      revenue: before,
      orders: beforeOrders,
      revenueDelta: round2(revenue - before),
      revenueDeltaPct: before ? round2(((revenue - before) / before) * 100) : 0,
      ordersDelta: sales.totals.orders - beforeOrders,
      avgOrderValueDelta: round2(sales.totals.avgOrderValue - (yesterdaySales?.totals.avgOrderValue ?? 0)),
    },
    hourly: sales.hourly,
    channels: sales.channels,
    sources: sales.sources,
    methods: payments.byMethod,
    providers: payments.byProvider,
    awaitingVerification: payments.awaitingVerification,
    cashierPerformance: payments.cashierPerformance,
    topProducts: products.topProducts,
    categories: products.categories,
    slowMovers: products.slowMovers,
    waiters: operations.waiters,
    occupancy: operations.occupancy,
    taxBreakup: operations.taxBreakup,
    bookings: operations.bookings,
    stock: {
      movements: movements.map((one) => {
        const item = itemNames.get(String(one.itemId));
        return {
          item: String(item?.name ?? ''),
          type: one.type,
          qty: one.qty,
          unit: String(item?.unit ?? ''),
          balanceAfter: one.balanceAfter,
          at: one.createdAt.toISOString(),
        };
      }),
      totals: [...byType.entries()].map(([type, qty]) => ({ type, qty: round2(qty) })),
      used: [...usedByItem.entries()]
        .map(([id, qty]) => ({ item: String(itemNames.get(id)?.name ?? ''), unit: String(itemNames.get(id)?.unit ?? ''), qty: round2(qty) }))
        .sort((a, b) => b.qty - a.qty),
      low: items
        .filter((one) => Number(one.stock) <= Number(one.lowStockThreshold ?? 0))
        .map((one) => ({ item: String(one.name), stock: one.stock, unit: String(one.unit), threshold: one.lowStockThreshold ?? 0 }))
        .sort((a, b) => a.stock - b.stock),
    },
    bills,
    orders,
  };
}

const SUMMARY_HEADER = [
  'Date',
  'Restaurant',
  'Generated',
  'Revenue',
  'Paid orders',
  'Average order value',
  'Covers',
  'Collected',
  'Refunded',
  'Net',
  'Bills',
  'Unpaid bills',
  'Unpaid amount',
  'Yesterday revenue',
  'Change vs yesterday %',
];

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(values: unknown[]): string {
  return values.map(cell).join(',');
}

/** One spreadsheet with a titled block per section, which is how a manager reads it in Excel. */
export function dayCloseCsv(report: DayCloseReport): string {
  const lines: string[] = [];
  const block = (title: string, header: string[], rows: unknown[][]) => {
    lines.push(title, row(header));
    for (const one of rows) lines.push(row(one));
    lines.push('');
  };

  lines.push(`Day close for ${report.restaurant.name} — ${report.date}`);
  lines.push('');
  block('Summary', SUMMARY_HEADER, [
      [
        report.date,
        report.restaurant.name,
        report.generatedAt,
        report.totals.revenue,
        report.totals.orders,
        report.totals.avgOrderValue,
        report.totals.covers,
        report.totals.collected,
        report.totals.refunded,
        report.totals.net,
        report.totals.bills,
        report.totals.unpaidBills,
        report.totals.unpaidAmount,
        report.versus.revenue,
        report.versus.revenueDeltaPct,
      ],
    ],
  );

  block(
    'Hourly revenue',
    ['Hour', 'Orders', 'Revenue'],
    report.hourly.filter((one) => one.orders > 0).map((one) => [one.hour, one.orders, one.revenue]),
  );

  block('By channel', ['Channel', 'Orders', 'Revenue'], report.channels.map((one) => [one.channel, one.orders, one.revenue]));
  block('By source', ['Source', 'Orders', 'Revenue'], report.sources.map((one) => [one.source, one.orders, one.revenue]));
  block('By payment method', ['Method', 'Payments', 'Amount'], report.methods.map((one) => [one.method, one.count, one.amount]));
  block(
    'Cashier collections',
    ['Name', 'Payments', 'Collected'],
    report.cashierPerformance.map((one) => [one.name, one.count, one.collected]),
  );
  block(
    'Dish totals',
    ['Dish', 'Category', 'Quantity', 'Revenue'],
    report.topProducts.map((one) => [one.name, one.category, one.qty, one.revenue]),
  );
  block(
    'Waiter sales',
    ['Waiter', 'Orders', 'Revenue'],
    report.waiters.map((one) => [one.name, one.orders, one.revenue]),
  );
  block(
    'Table sessions',
    ['Date', 'Sessions', 'Guests', 'Average minutes seated'],
    report.occupancy.map((one) => [one.date, one.sessions, one.guests, one.avgMinutes]),
  );
  block(
    'Tax breakup',
    ['Head', 'Percent', 'Amount'],
    report.taxBreakup.map((one) => [one.label, one.percent, one.amount]),
  );
  block(
    'Bookings',
    ['Status', 'Count'],
    report.bookings.map((one) => [one.status, one.count]),
  );
  block(
    'Stock used in the kitchen',
    ['Item', 'Unit', 'Quantity'],
    report.stock.used.map((one) => [one.item, one.unit, one.qty]),
  );
  block(
    'Stock movements',
    ['Time', 'Item', 'Type', 'Quantity', 'Unit', 'Balance after'],
    report.stock.movements.map((one) => [one.at, one.item, one.type, one.qty, one.unit, one.balanceAfter]),
  );
  block(
    'Low stock',
    ['Item', 'In stock', 'Unit', 'Reorder level'],
    report.stock.low.map((one) => [one.item, one.stock, one.unit, one.threshold]),
  );
  block(
    'Bills',
    [
      'Bill number',
      'Issued at',
      'Table',
      'Customer',
      'Orders',
      'Subtotal',
      'Tax',
      'Service charge',
      'Discount',
      'Round off',
      'Grand total',
      'Payment status',
      'Method',
      'Collected',
      'Paid at',
      'Raised by',
    ],
    report.bills.map((one) => [
      one.billNumber,
      one.issuedAt,
      one.tableNumber,
      one.customerName,
      one.orders,
      one.subtotal,
      one.taxTotal,
      one.serviceCharge,
      one.discountAmount,
      one.roundOff,
      one.grandTotal,
      one.paymentStatus,
      one.methods.join(' + '),
      one.collected,
      one.paidAt ?? '',
      one.issuedBy,
    ]),
  );
  block(
    'Orders',
    [
      'Order number',
      'Placed at',
      'Completed at',
      'Source',
      'Channel',
      'Table',
      'Waiter',
      'Lines',
      'Quantity',
      'Subtotal',
      'Tax',
      'Service charge',
      'Discount',
      'Grand total',
      'Status',
      'Payment status',
    ],
    report.orders.map((one) => [
      one.orderNumber,
      one.placedAt,
      one.completedAt ?? '',
      one.source,
      one.channel,
      one.tableNumber,
      one.waiter,
      one.items,
      one.quantity,
      one.subtotal,
      one.taxTotal,
      one.serviceCharge,
      one.discountAmount,
      one.grandTotal,
      one.status,
      one.paymentStatus,
    ]),
  );

  return `${lines.join('\n')}\n`;
}

/** `report/2026-10-13-day-close.json` inside the restaurant's own folder. */
export function dayClosePath(restaurantId: string, date: string, extension: 'json' | 'csv'): string {
  const folder = folderForRestaurant(restaurantId);
  if (!folder) throw new Error(`The archive holds no folder for restaurant ${restaurantId} yet.`);
  return `${folder}/report/${date}-day-close.${extension}`;
}

/**
 * Writes the day's close as JSON plus CSV and returns both paths. Regenerating replaces the pair, so a
 * bill corrected after 8 pm is reflected the next time the day is closed.
 */
export async function writeDayClose(
  restaurantId: string,
  date: string | Date = new Date(),
): Promise<{ date: string; jsonFile: string; csvFile: string; report: DayCloseReport }> {
  const report = await buildDayClose(restaurantId, date);
  const jsonFile = await writeArchiveFile(dayClosePath(restaurantId, report.date, 'json'), `${JSON.stringify(report, null, 2)}\n`);
  const csvFile = await writeArchiveFile(dayClosePath(restaurantId, report.date, 'csv'), dayCloseCsv(report));
  return { date: report.date, jsonFile, csvFile, report };
}

/** The close as it was written, or null when that day has not been closed yet. */
export async function readDayClose(restaurantId: string, date: string): Promise<DayCloseReport | null> {
  let file: string;
  try {
    file = dayClosePath(restaurantId, date, 'json');
  } catch {
    return null;
  }
  const text = await readArchiveFile(file);
  if (!text) return null;
  try {
    return JSON.parse(text) as DayCloseReport;
  } catch {
    // A hand-edited file is still a report the owner asked for; the live build answers instead.
    return null;
  }
}

/** Every closed day on the drive, newest first, with the two numbers an owner scans for. */
export async function listDayCloses(restaurantId: string): Promise<{ date: string; revenue: number; orders: number; bills: number; generatedAt: string }[]> {
  const folder = folderForRestaurant(restaurantId);
  if (!folder) return [];
  const names = await listArchiveFiles(`${folder}/report`);
  const out = [];
  for (const name of names) {
    const match = /^(\d{4}-\d{2}-\d{2})-day-close\.json$/.exec(name);
    if (!match) continue;
    const report = await readDayClose(restaurantId, match[1]);
    if (!report) continue;
    out.push({
      date: report.date,
      revenue: report.totals.revenue,
      orders: report.totals.orders,
      bills: report.totals.bills,
      generatedAt: report.generatedAt,
    });
  }
  return out;
}

/**
 * Closes a day only once, and only after it is over. The file on the drive is the record of the work
 * being done, so a restart never re-closes and a missed night is made up on the next tick.
 */
export async function runDayCloseSweep(now = new Date()): Promise<string[]> {
  const written: string[] = [];
  // Nothing to close until the clock is past midnight in Kolkata, and a five-minute grace period lets
  // an order that was still being served finish before its day is summed.
  const minutesIntoDay = Math.floor((now.getTime() + IST_OFFSET_MS) % 86_400_000 / 60_000);
  if (minutesIntoDay < 5) return written;
  const yesterday = addDays(startOfIstDay(now), -1);
  const restaurants = await RestaurantModel.find({}).select('_id').lean();
  for (const one of restaurants) {
    const id = String(one._id);
    const label = istDateLabel(yesterday);
    try {
      const stored = await readDayClose(id, label);
      // A close written before the day ended is a mid-day snapshot, not the finished article, so this
      // sweep rewrites it once the whole day is behind us. Without that, an owner who pressed "Close
      // this day" at lunch would freeze the report and lose the evening.
      if (stored && new Date(stored.generatedAt).getTime() > new Date(stored.window.to).getTime()) continue;
      const done = await writeDayClose(id, yesterday);
      const totals = done.report.totals;
      written.push(`${done.report.restaurant.name} ${done.date}`);
      // The close is only automatic if the people who run the floor hear about it; the notification
      // carries the two headline numbers so a manager knows whether to open the file.
      await notifyRoles(id, ['OWNER', 'MANAGER'], {
        type: 'DAY_CLOSE',
        title: `Day closed · ${done.date}`,
        body: `₹${totals.revenue.toLocaleString('en-IN')} across ${plural(totals.orders, 'paid order')} · ${plural(totals.bills, 'bill')} · ${totals.unpaidBills} still unpaid`,
        data: { date: done.date, revenue: totals.revenue, orders: totals.orders },
      });
    } catch (err) {
      console.warn(`[day-close] could not close ${label} for ${id}: ${(err as Error).message}`);
    }
  }
  return written;
}
