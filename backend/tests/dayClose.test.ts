// The end-of-day close, from the records to the file on the drive.
//
// A closed day is the document a restaurant keeps as its own record of the shift, so this case checks
// the three things that would be expensive to get wrong: the window is an Indian calendar day rather
// than a server-local one, the money in the file agrees with the live reports, and the automatic sweep
// writes each day exactly once and tells the owner and the manager when it does.
import { Types } from 'mongoose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BillModel,
  InventoryItemModel,
  InventoryTransactionModel,
  NotificationModel,
  OrderModel,
  PaymentModel,
  TableSessionModel,
} from '../src/models';
import { addDays, startOfIstDay } from '../src/services/report.service';
import {
  buildDayClose,
  dayCloseCsv,
  dayClosePath,
  dayWindow,
  istDateLabel,
  listDayCloses,
  readDayClose,
  runDayCloseSweep,
  writeDayClose,
} from '../src/services/dayClose.service';
import { folderForRestaurant, readArchiveFile, writeArchiveFile } from '../src/store';
import { randomToken } from '../src/utils/tokens';
import { connectTestDb, disconnectTestDb, makeDiner, resetDb, type Diner } from './helpers';

const HOUR = 60 * 60_000;
const MINUTE = 60_000;
const uid = (prefix: string) => `${prefix}-${randomToken(4)}`;

let diner: Diner;
/** One minute into the Indian day being closed: certainly inside it, whatever the server clock says. */
let today: Date;
let yesterday: Date;

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
  diner = await makeDiner();
  today = new Date(startOfIstDay().getTime() + MINUTE);
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

/** Two settled orders and one bill today, one order yesterday, a live ticket, and the stock that moved. */
async function aDayOfService() {
  const dineIn = await OrderModel.create(order({ waiterId: diner.waiterId, tableId: diner.smallTableId }));
  await OrderModel.create(
    order({
      source: 'ZOMATO',
      fulfilment: 'DELIVERY',
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
    billNumber: 'INV-TEST-0001',
    orderIds: [dineIn._id],
    tableId: diner.smallTableId,
    tableNumber: 'S1',
    customerName: 'Naina, table side',
    subtotal: 500,
    taxTotal: 90,
    grandTotal: 590,
    taxBreakup: [
      { label: 'CGST', percent: 5, amount: 32 },
      { label: 'SGST', percent: 5, amount: 32 },
    ],
    status: 'ISSUED',
    paymentStatus: 'PAID',
    paidAt: today,
    publicToken: uid('bill-token'),
    issuedByUserId: diner.cashierId,
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
    provider: 'CASH',
    amount: 270,
    status: 'SUCCEEDED',
    verifiedAt: today,
    collectedByUserId: diner.cashierId,
  });
  // Claimed money belongs on the close as a question, never as income.
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
    status: 'OPEN',
    openedAt: today,
    guestCount: 4,
  });

  await InventoryItemModel.updateOne({ _id: diner.flourItemId }, { $set: { stock: 1.5 } });
  await InventoryTransactionModel.create({
    restaurantId: diner.restaurantId,
    itemId: diner.flourItemId,
    type: 'DEDUCTION',
    qty: 0.5,
    balanceAfter: 19.5,
    createdAt: today,
  });
  await InventoryTransactionModel.create({
    restaurantId: diner.restaurantId,
    itemId: diner.flourItemId,
    type: 'RECEIPT',
    qty: 10,
    balanceAfter: 19,
    createdAt: today,
  });

  return { bill, dineIn };
}

describe('the day the close covers', () => {
  it('runs midnight to midnight in Indian time, not the server clock', () => {
    const window = dayWindow('2026-10-13');
    expect(window.date).toBe('2026-10-13');
    // Midnight in Kolkata is 18:30 UTC on the 12th, and the day ends one millisecond before the next.
    expect(window.from.toISOString()).toBe('2026-10-12T18:30:00.000Z');
    expect(window.to.toISOString()).toBe('2026-10-13T18:29:59.999Z');

    // A bill at 23:30 IST belongs to that day even though UTC is already the next morning.
    expect(istDateLabel(new Date('2026-10-13T18:00:00Z'))).toBe('2026-10-13');
    expect(istDateLabel(new Date('2026-10-13T18:30:00Z'))).toBe('2026-10-14');
  });
});

describe('the built close', () => {
  it('carries the same money the live reports show, plus yesterday beside it', async () => {
    await aDayOfService();

    const report = await buildDayClose(diner.restaurantId, today);

    expect(report.restaurant.name).toBe('Test Bistro');
    expect(report.date).toBe(istDateLabel(today));
    expect(report.totals).toEqual({
      revenue: 974,
      orders: 2,
      avgOrderValue: 487,
      covers: 4,
      tax: 32,
      serviceCharge: 32,
      discount: 0,
      collected: 974,
      refunded: 104,
      net: 870,
      bills: 1,
      // The bill itself is settled, so nothing is owed on it even though a claim is still unverified.
      unpaidBills: 0,
      unpaidAmount: 0,
      cancelledOrders: 0,
    });
    expect(report.versus).toMatchObject({ revenue: 318, orders: 1, revenueDelta: 656, revenueDeltaPct: 206.29 });
    expect(report.channels).toEqual([
      { channel: 'DINE_IN', revenue: 704, orders: 1 },
      { channel: 'DELIVERY', revenue: 270, orders: 1 },
    ]);
    expect(report.methods).toEqual([
      { method: 'UPI', amount: 704, count: 1 },
      { method: 'CASH', amount: 270, count: 1 },
    ]);
    expect(report.awaitingVerification).toEqual({ amount: 500, count: 1 });

    // Twenty-four slots so the hourly chart has a bar for every hour the restaurant was open.
    expect(report.hourly).toHaveLength(24);
    expect(report.hourly[0]).toEqual({ hour: 0, orders: 2, revenue: 974 });

    expect(report.cashierPerformance).toEqual([
      { userId: diner.cashierId, name: 'Rohit Test', collected: 974, count: 2 },
    ]);
  });

  it('lists every bill and every order with the people and the table on them', async () => {
    const { bill } = await aDayOfService();

    const report = await buildDayClose(diner.restaurantId, today);

    expect(report.bills).toHaveLength(1);
    expect(report.bills[0]).toMatchObject({
      billId: String(bill._id),
      billNumber: 'INV-TEST-0001',
      tableNumber: 'S1',
      customerName: 'Naina, table side',
      orders: 1,
      grandTotal: 590,
      paymentStatus: 'PAID',
      collected: 974,
      issuedBy: 'Rohit Test',
    });
    expect(report.bills[0].methods).toEqual(['UPI', 'CASH']);
    expect(report.bills[0].paidAt).toBeTruthy();

    const dineIn = report.orders.find((one) => one.channel === 'DINE_IN')!;
    expect(dineIn).toMatchObject({
      orderNumber: expect.any(String),
      source: 'DINE_IN_QR',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      tableNumber: 'S1',
      waiter: 'Sneha Test',
      items: 1,
      quantity: 2,
      grandTotal: 704,
    });
    expect(dineIn.completedAt).toBeTruthy();
    // The ticket still in the kitchen is on the list, unpaid, because the close shows the whole day.
    const live = report.orders.find((one) => one.status === 'PLACED')!;
    expect(live.paymentStatus).toBe('UNPAID');
    expect(live.completedAt).toBeNull();
    // A delivery is billed to nobody's table, and the close says so instead of guessing.
    expect(report.orders.find((one) => one.source === 'ZOMATO')!.tableNumber).toBe('');
    // Yesterday's order is not in today's list: the close covers one calendar day, no more.
    expect(report.orders).toHaveLength(3);
  });

  it('separates what the kitchen drew from what the pantry received', async () => {
    await aDayOfService();

    const report = await buildDayClose(diner.restaurantId, today);

    expect(report.stock.movements).toHaveLength(2);
    expect(report.stock.used).toEqual([{ item: 'Flour', unit: 'KG', qty: 0.5 }]);
    expect(report.stock.totals).toEqual([
      { type: 'DEDUCTION', qty: 0.5 },
      { type: 'RECEIPT', qty: 10 },
    ]);
    expect(report.stock.low).toEqual([{ item: 'Flour', stock: 1.5, unit: 'KG', threshold: 2 }]);
  });

  it('answers with nothing at all on a day that had no service', async () => {
    const report = await buildDayClose(diner.restaurantId, addDays(startOfIstDay(), -3));

    expect(report.totals.revenue).toBe(0);
    expect(report.totals.orders).toBe(0);
    expect(report.bills).toEqual([]);
    expect(report.orders).toEqual([]);
    expect(report.hourly.every((one) => one.orders === 0 && one.revenue === 0)).toBe(true);
    expect(report.versus.revenueDeltaPct).toBe(0);
  });
});

describe('the written close', () => {
  it('lands as a JSON file and a spreadsheet in the report folder of its own restaurant', async () => {
    await aDayOfService();

    const done = await writeDayClose(diner.restaurantId, today);

    expect(done.jsonFile).toBe('Test Bistro/report/' + done.date + '-day-close.json');
    expect(done.csvFile).toBe('Test Bistro/report/' + done.date + '-day-close.csv');
    expect(folderForRestaurant(diner.restaurantId)).toBe('Test Bistro');
    expect(await readArchiveFile(dayClosePath(diner.restaurantId, done.date, 'json'))).toContain('INV-TEST-0001');
    expect(await readArchiveFile(dayClosePath(diner.restaurantId, done.date, 'csv'))).toContain('INV-TEST-0001');

    const stored = (await readDayClose(diner.restaurantId, done.date))!;
    expect(stored.totals).toEqual(done.report.totals);
    expect(stored.bills).toHaveLength(1);
    expect(stored.generatedAt).toBe(done.report.generatedAt);

    expect(await listDayCloses(diner.restaurantId)).toEqual([
      {
        date: done.date,
        revenue: 974,
        orders: 2,
        bills: 1,
        generatedAt: done.report.generatedAt,
      },
    ]);
  });

  it('writes a spreadsheet a person can open, with every block and a comma-safe cell', async () => {
    await aDayOfService();

    const csv = dayCloseCsv(await buildDayClose(diner.restaurantId, today));

    expect(csv).toContain('Day close for Test Bistro');
    for (const block of ['Summary', 'Hourly revenue', 'By payment method', 'Dish totals', 'Bills', 'Orders', 'Low stock']) {
      expect(csv).toContain(block);
    }
    expect(csv).toContain('INV-TEST-0001');
    expect(csv).toContain('"Naina, table side"');
    expect(csv).toContain('Orders\nOrder number,Placed at,');
  });

  it('closes a finished day once, tells the owner and the manager, and never closes it twice', async () => {
    await aDayOfService();
    // Six minutes past Indian midnight: the previous day is over and its close is due.
    const justAfterMidnight = new Date(startOfIstDay().getTime() + 6 * MINUTE);
    const label = istDateLabel(addDays(startOfIstDay(justAfterMidnight), -1));

    const first = await runDayCloseSweep(justAfterMidnight);

    expect(first).toHaveLength(1);
    expect(first[0]).toContain(label);
    const closed = (await readDayClose(diner.restaurantId, label))!;
    // Yesterday's single settled order is the whole of that day's revenue.
    expect(closed.totals.revenue).toBe(318);
    expect(closed.totals.orders).toBe(1);

    const notices = await NotificationModel.find({ type: 'DAY_CLOSE' }).lean();
    expect(notices.map((one) => String(one.recipientId)).sort()).toEqual([diner.managerId, diner.ownerId].sort());
    expect(notices[0].title).toBe(`Day closed · ${label}`);

    expect(await runDayCloseSweep(new Date(justAfterMidnight.getTime() + HOUR))).toEqual([]);
    expect(await NotificationModel.countDocuments({ type: 'DAY_CLOSE' })).toBe(2);
  });

  it('rewrites a day that was closed while it was still running', async () => {
    await aDayOfService();
    const label = istDateLabel(addDays(startOfIstDay(), -1));
    const snapshot = await writeDayClose(diner.restaurantId, label);
    // The owner pressed the button over lunch, so the file on the drive records a day that had not
    // finished yet. The sweep has to notice that and sum the whole day once it is behind us.
    const midDay = new Date(new Date(snapshot.report.window.from).getTime() + 6 * HOUR);
    await writeArchiveFile(
      dayClosePath(diner.restaurantId, label, 'json'),
      JSON.stringify({ ...snapshot.report, generatedAt: midDay.toISOString() }),
    );

    const justAfterMidnight = new Date(startOfIstDay().getTime() + 6 * MINUTE);
    expect(await runDayCloseSweep(justAfterMidnight)).toHaveLength(1);

    const rewritten = (await readDayClose(diner.restaurantId, label))!;
    expect(new Date(rewritten.generatedAt).getTime()).toBeGreaterThan(new Date(rewritten.window.to).getTime());
    expect(rewritten.totals.revenue).toBe(318);
  });

  it('leaves a day that is still running alone', async () => {
    await aDayOfService();
    // Ten minutes short of Indian midnight: yesterday is already closed, today is not.
    const lateTonight = new Date(startOfIstDay().getTime() + 23 * HOUR + 50 * MINUTE);
    const label = istDateLabel(addDays(startOfIstDay(lateTonight), -1));

    expect(await runDayCloseSweep(lateTonight)).toHaveLength(1);
    expect((await listDayCloses(diner.restaurantId)).map((one) => one.date)).toEqual([label]);
    expect(await readDayClose(diner.restaurantId, istDateLabel(lateTonight))).toBeNull();
  });

  it('says nothing about a restaurant that has no folder on the drive yet', async () => {
    await aDayOfService();
    const stranger = new Types.ObjectId();

    expect(() => dayClosePath(String(stranger), istDateLabel(today), 'json')).toThrow(/no folder/);
    expect(await readDayClose(String(stranger), istDateLabel(today))).toBeNull();
    expect(await listDayCloses(String(stranger))).toEqual([]);
  });
});
