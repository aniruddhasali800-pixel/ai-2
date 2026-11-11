// The dashboard and the four reports, end to end over the file store.
//
// Every number an owner sees comes through one of these functions, so this case is the proof that
// the aggregation engine answers the way the screens expect: revenue that quietly missed an order, a
// waiter listed without a name, or a day bucket on the wrong date is a wrong number on a
// restaurant's own report, not a cosmetic fault.
import { Types } from 'mongoose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BillModel, BookingModel, OrderModel, PaymentModel, TableSessionModel } from '../src/models';
import {
  addDays,
  dashboard,
  operationsReport,
  paymentReport,
  productReport,
  salesReport,
  startOfIstDay,
} from '../src/services/report.service';
import { randomToken } from '../src/utils/tokens';
import { connectTestDb, disconnectTestDb, makeDiner, resetDb, type Diner } from './helpers';

const HOUR = 60 * 60_000;
const uid = (prefix: string) => `${prefix}-${randomToken(4)}`;

let diner: Diner;
/** One minute into the Indian day the dashboard is reporting on: certainly the same calendar day. */
let today: Date;
let yesterday: Date;
/** The last instant of the Indian day being reported, so a range never spills into tomorrow. */
const ahead = () => new Date(startOfIstDay().getTime() + 24 * HOUR - 1);

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
  diner = await makeDiner();
  today = new Date(startOfIstDay().getTime() + 60_000);
  yesterday = new Date(startOfIstDay().getTime() - 12 * HOUR);
});
afterAll(disconnectTestDb);

function order(over: Record<string, unknown> = {}) {
  return {
    restaurantId: diner.restaurantId,
    orderNumber: uid('O'),
    source: 'DINE_IN_QR',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    items: [{ name: 'Butter Chicken', price: 320, qty: 2, lineTotal: 640, productId: diner.mainsProductId }],
    subtotal: 640,
    taxTotal: 32,
    serviceCharge: 32,
    discountAmount: 0,
    grandTotal: 704,
    placedAt: today,
    completedAt: today,
    ...over,
  };
}

/** Two settled orders today, one yesterday, a ticket still in the kitchen, and the money around them. */
async function aBusyService() {
  const dineIn = await OrderModel.create(order({ waiterId: diner.waiterId }));
  await OrderModel.create(
    order({
      source: 'ZOMATO',
      items: [{ name: 'Cola', price: 90, qty: 3, lineTotal: 270, productId: diner.colaProductId }],
      subtotal: 270,
      taxTotal: 0,
      serviceCharge: 0,
      grandTotal: 270,
    }),
  );
  await OrderModel.create(
    order({
      source: 'CASHIER',
      items: [{ name: 'Butter Chicken', price: 320, qty: 1, lineTotal: 320, productId: diner.mainsProductId }],
      subtotal: 320,
      taxTotal: 32,
      serviceCharge: 16,
      discountAmount: 50,
      grandTotal: 318,
      placedAt: yesterday,
      completedAt: yesterday,
    }),
  );
  await OrderModel.create(order({ status: 'PLACED', paymentStatus: 'UNPAID', completedAt: null }));

  const bill = await BillModel.create({
    restaurantId: diner.restaurantId,
    billNumber: uid('B'),
    orderIds: [dineIn._id],
    subtotal: 500,
    taxTotal: 90,
    grandTotal: 590,
    taxBreakup: [
      { label: 'CGST', percent: 5, amount: 32 },
      { label: 'SGST', percent: 5, amount: 32 },
    ],
    paymentStatus: 'UNPAID',
    status: 'ISSUED',
    publicToken: uid('bill-token'),
  });

  await PaymentModel.create({
    restaurantId: diner.restaurantId,
    billId: bill._id,
    method: 'UPI',
    provider: 'BILL_SERVICE',
    amount: 704,
    status: 'SUCCEEDED',
    verifiedAt: today,
    collectedByUserId: diner.cashierId,
    refunds: [{ amount: 104, reason: 'One dish sent back' }],
  });
  await PaymentModel.create({
    restaurantId: diner.restaurantId,
    billId: bill._id,
    method: 'CASH',
    provider: '',
    amount: 270,
    status: 'SUCCEEDED',
    verifiedAt: today,
    collectedByUserId: diner.cashierId,
  });
  // A guest's own claim: seen on the report, never counted as income.
  await PaymentModel.create({
    restaurantId: diner.restaurantId,
    billId: bill._id,
    method: 'UPI',
    provider: 'BILL_SERVICE',
    amount: 500,
    status: 'VERIFICATION_PENDING',
  });

  await TableSessionModel.create({
    restaurantId: diner.restaurantId,
    tableId: diner.smallTableId,
    publicToken: uid('session'),
    status: 'CLOSED',
    openedAt: yesterday,
    closedAt: new Date(yesterday.getTime() + HOUR),
    guestCount: 2,
  });
  await TableSessionModel.create({
    restaurantId: diner.restaurantId,
    tableId: diner.largeTableId,
    publicToken: uid('session'),
    status: 'OPEN',
    openedAt: today,
    guestCount: 4,
  });

  await BookingModel.create({
    restaurantId: diner.restaurantId,
    tableId: diner.largeTableId,
    customerName: 'Ganesh Babu',
    customerPhone: '9999900000',
    // Five minutes out, but never past the midnight the report stops at: the dashboard counts this as
    // an upcoming booking, so it has to stay in front of "now" and inside the day under report.
    startAt: new Date(Math.min(Date.now() + 5 * 60_000, startOfIstDay().getTime() + 24 * HOUR - 1)),
    durationMinutes: 90,
    guests: 5,
    status: 'CONFIRMED',
  });
}

describe('the sales report', () => {
  it('totals settled orders into the Indian days they happened on', async () => {
    await aBusyService();

    const report = await salesReport(diner.restaurantId, { from: addDays(startOfIstDay(), -1), to: ahead(), granularity: 'day' });

    // 704 + 270 today and 318 yesterday: the unpaid, still-cooking ticket is not revenue.
    expect(report.totals).toEqual({
      revenue: 1292,
      orders: 3,
      avgOrderValue: 430.67,
      tax: 64,
      discount: 50,
      serviceCharge: 48,
    });

    expect(report.series).toEqual([
      { label: labelOf(yesterday), revenue: 318, orders: 1 },
      { label: labelOf(today), revenue: 974, orders: 2 },
    ]);

    expect(report.channels).toEqual([
      { channel: 'DINE_IN', revenue: 1022, orders: 2 },
      { channel: 'DELIVERY', revenue: 270, orders: 1 },
    ]);
    expect(report.sources.map((source) => [source.source, source.revenue])).toEqual([
      ['DINE_IN_QR', 704],
      ['CASHIER', 318],
      ['ZOMATO', 270],
    ]);

    const tradingHours = report.hourly.filter((hour) => hour.orders > 0);
    expect(tradingHours.reduce((sum, hour) => sum + hour.revenue, 0)).toBe(1292);
    expect(tradingHours.reduce((sum, hour) => sum + hour.orders, 0)).toBe(3);
  });

  it('leaves a quiet day in the series rather than dropping it', async () => {
    await aBusyService();
    const report = await salesReport(diner.restaurantId, { from: addDays(startOfIstDay(), -2), to: ahead(), granularity: 'day' });
    expect(report.series).toEqual([
      { label: labelOf(addDays(startOfIstDay(), -2)), revenue: 0, orders: 0 },
      { label: labelOf(yesterday), revenue: 318, orders: 1 },
      { label: labelOf(today), revenue: 974, orders: 2 },
    ]);
  });

  it('names a weekly bucket by its ISO week, not by any date inside it', async () => {
    await aBusyService();
    const report = await salesReport(diner.restaurantId, { from: addDays(startOfIstDay(), -20), to: ahead(), granularity: 'week' });
    expect(report.series.every((point) => /^\d{4}-W\d{2}$/.test(point.label))).toBe(true);
    expect(report.series.reduce((sum, point) => sum + point.orders, 0)).toBe(3);
  });
});

describe('the payments report', () => {
  it('counts money by when it was confirmed and keeps a claim out of the total', async () => {
    await aBusyService();

    const report = await paymentReport(diner.restaurantId, addDays(startOfIstDay(), -1), ahead());

    expect(report.totals).toEqual({ collected: 974, refunded: 104, net: 870, count: 2 });
    expect(report.byMethod).toEqual([
      { method: 'UPI', amount: 704, count: 1 },
      { method: 'CASH', amount: 270, count: 1 },
    ]);
    expect(report.byProvider).toEqual([
      { provider: 'BILL_SERVICE', amount: 704, count: 1 },
      { provider: '', amount: 270, count: 1 },
    ]);
    // The name behind the id comes from the join, so the league page never prints "Unknown".
    expect(report.cashierPerformance).toEqual([{ userId: diner.cashierId, name: 'Rohit Test', collected: 974, count: 2 }]);
    expect(report.awaitingVerification).toEqual({ amount: 500, count: 1 });
  });
});

describe('the product report', () => {
  it('ranks dishes by revenue and finds the category behind each one', async () => {
    await aBusyService();

    const report = await productReport(diner.restaurantId, startOfIstDay(), ahead());

    expect(report.topProducts).toEqual([
      { productId: diner.mainsProductId, name: 'Butter Chicken', category: 'Mains', qty: 2, revenue: 640 },
      { productId: diner.colaProductId, name: 'Cola', category: 'Mains', qty: 3, revenue: 270 },
    ]);
    expect(report.categories).toEqual([{ category: 'Mains', qty: 5, revenue: 910 }]);
    expect(report.slowMovers.map((item) => item.name)).toEqual(['Cola', 'Butter Chicken']);
  });

  it('still shows a dish the menu has dropped, rather than losing its revenue', async () => {
    await OrderModel.create(
      order({
        items: [{ name: 'Old Special', price: 400, qty: 1, lineTotal: 400, productId: new Types.ObjectId() }],
        subtotal: 400,
        taxTotal: 0,
        serviceCharge: 0,
        grandTotal: 400,
      }),
    );
    const report = await productReport(diner.restaurantId, startOfIstDay(), ahead());
    expect(report.topProducts[0]).toMatchObject({ name: 'Old Special', category: 'Uncategorised', revenue: 400 });
    expect(report.categories).toEqual([{ category: 'Uncategorised', qty: 1, revenue: 400 }]);
  });
});

describe('the operations report', () => {
  it('gives each waiter their own total, with the name the roster holds', async () => {
    await aBusyService();

    const report = await operationsReport(diner.restaurantId, startOfIstDay(), ahead());

    expect(report.waiters).toEqual([{ userId: diner.waiterId, name: 'Sneha Test', orders: 1, revenue: 704 }]);
    expect(report.taxBreakup).toEqual([
      { label: 'CGST', percent: 5, amount: 32 },
      { label: 'SGST', percent: 5, amount: 32 },
    ]);
    expect(report.bookings).toEqual([{ status: 'CONFIRMED', count: 1 }]);
    expect(report.tableStatus.reduce((sum, row) => sum + row.count, 0)).toBe(2);
  });

  it('measures how long a table sat, on the day the party opened', async () => {
    await aBusyService();
    const report = await operationsReport(diner.restaurantId, addDays(startOfIstDay(), -1), ahead());
    expect(report.occupancy).toEqual([{ date: labelOf(yesterday), sessions: 1, guests: 2, avgMinutes: 60 }]);
  });
});

describe('the dashboard', () => {
  it('shows today against yesterday and the money that is still owed', async () => {
    await aBusyService();

    const view = await dashboard(diner.restaurantId);

    expect(view.today).toEqual({ revenue: 974, orders: 2, avgOrderValue: 487, trendPct: 206.29 });
    expect(view.yesterday).toEqual({ revenue: 318, orders: 1 });
    expect(view.live).toEqual({ activeOrders: 1, unpaidBills: 1, unpaidAmount: 590, openSessions: 1 });
    expect(view.topItems).toEqual([
      { name: 'Butter Chicken', qty: 2, revenue: 640 },
      { name: 'Cola', qty: 3, revenue: 270 },
    ]);
    expect(view.upcomingBookings).toBe(1);
    expect(view.tables.reduce((sum, row) => sum + row.count, 0)).toBe(2);
    expect(view.recentOrders).toHaveLength(4);
    expect(view.recentOrders[0]).toMatchObject({ orderNumber: expect.any(String), grandTotal: expect.any(Number) });
    expect(view.week).toHaveLength(7);
    expect(view.hourly).toHaveLength(24);
    expect(view.hourly.reduce((sum, hour) => sum + hour.orders, 0)).toBe(2);
  });

  it('answers zero rather than a missing field on a day nobody has traded', async () => {
    const view = await dashboard(diner.restaurantId);
    expect(view.today).toEqual({ revenue: 0, orders: 0, avgOrderValue: 0, trendPct: 0 });
    expect(view.yesterday).toEqual({ revenue: 0, orders: 0 });
    expect(view.topItems).toEqual([]);
    expect(view.live).toEqual({ activeOrders: 0, unpaidBills: 0, unpaidAmount: 0, openSessions: 0 });
    expect(view.week.every((point) => point.revenue === 0 && point.orders === 0)).toBe(true);
  });
});

/** The Indian calendar date of an instant, which is the label the report prints beside it. */
function labelOf(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}
