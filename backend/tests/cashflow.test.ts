import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, makeDiner, makeProduct, makeTable, makeUser, actor, resetDb } from './helpers';
import { CustomerRequestModel, OrderModel, TableModel, TableSessionModel } from '../src/models';
import { createOrder, kitchenQueue, transitionOrder } from '../src/services/order.service';
import { openSession } from '../src/services/table.service';
import { createBill, recordCashPayment } from '../src/services/billing.service';
import { roleHasPermission } from '../src/types/constants';
import { round2 } from '../src/utils/money';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

const guest = { userId: null, role: 'SYSTEM' as const, name: 'Guest request' };

async function seatedTable(diner: Awaited<ReturnType<typeof makeDiner>>) {
  const session = await openSession({
    restaurantId: diner.restaurantId,
    tableId: diner.smallTableId,
    guestCount: 3,
    customerName: 'Guest party',
    via: 'QR',
  });
  return session;
}

async function dineIn(diner: Awaited<ReturnType<typeof makeDiner>>, session: { _id: unknown }, productId: string, qty: number) {
  return createOrder({
    restaurantId: diner.restaurantId,
    source: 'DINE_IN_QR',
    tableId: diner.smallTableId,
    tableSessionId: String(session._id),
    actor: guest,
    items: [{ productId, qty }],
  });
}

describe('one bill per table', () => {
  it('combines every order the table has run into a single bill', async () => {
    const diner = await makeDiner();
    const session = await seatedTable(diner);
    const first = await dineIn(diner, session, diner.mainsProductId, 1);
    // The pass has started this fire, so the next tap is a second round and not the same order twice.
    await transitionOrder(diner.restaurantId, String(first._id), 'ACCEPTED', actor(diner.managerId, 'MANAGER'));
    await transitionOrder(diner.restaurantId, String(first._id), 'PREPARING', actor(diner.managerId, 'MANAGER'));
    const second = await dineIn(diner, session, diner.colaProductId, 2);

    const bill = await createBill({ restaurantId: diner.restaurantId, actor: guest, sessionId: String(session._id) });

    expect(bill.orderIds.map(String).sort()).toEqual([String(first._id), String(second._id)].sort());
    expect(bill.subtotal).toBe(round2(first.subtotal + second.subtotal));
    expect(bill.tableNumber).toBe('S1');

    const orders = await OrderModel.find({ _id: { $in: bill.orderIds } }).lean();
    expect(orders.every((o) => String(o.billId) === String(bill._id))).toBe(true);

    // A second tap on the same table must not print a second total.
    const again = await createBill({ restaurantId: diner.restaurantId, actor: guest, sessionId: String(session._id) });
    expect(String(again._id)).toBe(String(bill._id));
  });

  it('keeps veg and non-veg apart on the lines the pass and the bill read', async () => {
    const diner = await makeDiner();
    const paneer = await makeProduct(diner.restaurantId, diner.categoryId, { name: 'Paneer Tikka', price: 260 });
    const session = await seatedTable(diner);

    const order = await createOrder({
      restaurantId: diner.restaurantId,
      source: 'DINE_IN_QR',
      tableId: diner.smallTableId,
      tableSessionId: String(session._id),
      actor: guest,
      items: [
        { productId: diner.mainsProductId, qty: 1 },
        { productId: String(paneer._id), qty: 1 },
      ],
    });

    expect(order.items.map((i) => i.isVeg)).toEqual([false, true]);

    const [ticket] = await kitchenQueue(diner.restaurantId);
    expect(ticket.tableNumber).toBe('S1');
  });
});

describe('cash handed over at the table', () => {
  it('lets a waiter bill the table but never confirm the money', () => {
    expect(roleHasPermission('WAITER', 'billing:write')).toBe(true);
    expect(roleHasPermission('WAITER', 'requests:write')).toBe(true);
    expect(roleHasPermission('WAITER', 'payments:write')).toBe(false);
    expect(roleHasPermission('CASHIER', 'payments:write')).toBe(true);
  });

  it('settles on the counted notes, returns change and sends the table to cleaning', async () => {
    const diner = await makeDiner();
    const session = await seatedTable(diner);
    await dineIn(diner, session, diner.mainsProductId, 1);
    const bill = await createBill({ restaurantId: diner.restaurantId, actor: guest, sessionId: String(session._id) });

    const settled = await recordCashPayment({
      restaurantId: diner.restaurantId,
      billId: String(bill._id),
      actor: actor(diner.cashierId, 'CASHIER', 'Rohit'),
      tendered: bill.grandTotal + 300,
      note: 'Collected at the table by the waiter',
    });

    expect(settled.payment.method).toBe('CASH');
    expect(settled.payment.change).toBe(300);
    expect(settled.bill?.paymentStatus).toBe('PAID');

    const closedSession = await TableSessionModel.findById(session._id).lean();
    expect(closedSession?.status).toBe('CLOSED');
    const table = await TableModel.findById(diner.smallTableId).lean();
    expect(table?.status).toBe('CLEANING');

    const orders = await OrderModel.find({ _id: { $in: bill.orderIds } }).lean();
    expect(orders.every((o) => o.status === 'COMPLETED' && o.paymentStatus === 'PAID')).toBe(true);
  });

  it('answers the bill and cash calls with the money that settled them', async () => {
    const diner = await makeDiner();
    const session = await seatedTable(diner);
    await dineIn(diner, session, diner.mainsProductId, 1);
    const bill = await createBill({ restaurantId: diner.restaurantId, actor: guest, sessionId: String(session._id) });

    await CustomerRequestModel.create([
      { restaurantId: diner.restaurantId, tableId: diner.smallTableId, tableSessionId: session._id, type: 'BILL', status: 'ACKNOWLEDGED' },
      { restaurantId: diner.restaurantId, tableId: diner.smallTableId, tableSessionId: session._id, type: 'CASH_PAYMENT', status: 'OPEN' },
      { restaurantId: diner.restaurantId, tableId: diner.smallTableId, tableSessionId: session._id, type: 'WATER', status: 'OPEN' },
    ]);

    await recordCashPayment({
      restaurantId: diner.restaurantId,
      billId: String(bill._id),
      actor: actor(diner.cashierId, 'CASHIER', 'Rohit'),
      tendered: bill.grandTotal,
    });

    // A counter queue still holding "collect ₹990" after the cash was counted reads like a lost
    // payment, so the settle itself has to close the calls that asked for it.
    const after = await CustomerRequestModel.find({ tableSessionId: session._id }).lean();
    const byType = Object.fromEntries(after.map((r) => [r.type, r.status]));
    expect(byType).toMatchObject({ BILL: 'DONE', CASH_PAYMENT: 'DONE' });
    // A refill call is still owed to the guests at the table, whoever they turn out to be.
    expect(byType.WATER).toBe('OPEN');
  });
});

describe('one fire per table', () => {
  it('grows the running order when a table is punched again before the kitchen starts', async () => {
    const diner = await makeDiner();
    const session = await seatedTable(diner);
    const first = await dineIn(diner, session, diner.mainsProductId, 1);
    const again = await dineIn(diner, session, diner.colaProductId, 2);

    expect(String(again._id)).toBe(String(first._id));
    expect(again.merged).toBe(true);
    expect(again.items).toHaveLength(2);
    expect(again.subtotal).toBe(round2(320 + 2 * 90));

    const fires = await OrderModel.countDocuments({
      restaurantId: diner.restaurantId,
      tableSessionId: session._id,
    }).lean();
    expect(fires).toBe(1);
  });
});

describe('every waiter works every table', () => {
  it('lets a second waiter join, serve and bill a party someone else opened', async () => {
    const diner = await makeDiner();
    const table = await makeTable(diner.restaurantId, 'S9', 2);
    const session = await openSession({ restaurantId: diner.restaurantId, tableId: String(table._id), via: 'STAFF' });
    const sneha = actor(diner.waiterId, 'WAITER', 'Sneha Test');
    const imran = actor(String((await makeUser(diner.restaurantId, 'WAITER', 'Imran Test'))._id), 'WAITER', 'Imran Test');
    const manager = actor(diner.managerId, 'MANAGER', 'Manager Test');

    const punched = await createOrder({
      restaurantId: diner.restaurantId,
      source: 'DINE_IN_WAITER',
      tableId: String(table._id),
      tableSessionId: String(session._id),
      actor: sneha,
      items: [{ productId: diner.mainsProductId, qty: 1 }],
    });
    expect(punched.orderNumber).toMatch(/^D-/);

    // Nothing refuses Imran: his tap joins the fire that is already running for this party.
    const joined = await createOrder({
      restaurantId: diner.restaurantId,
      source: 'DINE_IN_WAITER',
      tableId: String(table._id),
      tableSessionId: String(session._id),
      actor: imran,
      items: [{ productId: diner.colaProductId, qty: 1 }],
    });
    expect(String(joined._id)).toBe(String(punched._id));
    expect(joined.merged).toBe(true);

    // The name on the table is who opened the party. It tells the floor who to ask; it does not
    // tell anyone else to go away.
    const held = await TableModel.findById(table._id).lean();
    expect(String(held?.assignedWaiterId)).toBe(diner.waiterId);

    await transitionOrder(diner.restaurantId, String(punched._id), 'ACCEPTED', manager);
    await transitionOrder(diner.restaurantId, String(punched._id), 'PREPARING', manager);
    await transitionOrder(diner.restaurantId, String(punched._id), 'READY', manager);
    const served = await transitionOrder(diner.restaurantId, String(punched._id), 'SERVED', imran);
    expect(served.status).toBe('SERVED');

    const bill = await createBill({ restaurantId: diner.restaurantId, actor: imran, sessionId: String(session._id) });
    expect(bill.orderIds.map(String)).toEqual([String(punched._id)]);
  });

  it('joins two punches sent in the same breath into one fire', async () => {
    const diner = await makeDiner();
    const table = await makeTable(diner.restaurantId, 'S8', 2);
    const session = await openSession({ restaurantId: diner.restaurantId, tableId: String(table._id), via: 'STAFF' });
    const sneha = actor(diner.waiterId, 'WAITER', 'Sneha Test');
    const imran = actor(String((await makeUser(diner.restaurantId, 'WAITER', 'Imran Test'))._id), 'WAITER', 'Imran Test');

    const [first, second] = await Promise.all([
      createOrder({
        restaurantId: diner.restaurantId,
        source: 'DINE_IN_WAITER',
        tableId: String(table._id),
        tableSessionId: String(session._id),
        actor: sneha,
        items: [{ productId: diner.mainsProductId, qty: 1 }],
      }),
      createOrder({
        restaurantId: diner.restaurantId,
        source: 'DINE_IN_WAITER',
        tableId: String(table._id),
        tableSessionId: String(session._id),
        actor: imran,
        items: [{ productId: diner.colaProductId, qty: 1 }],
      }),
    ]);

    // Two phones, one tap each, no waiter refused — and still one ticket for the kitchen.
    expect(String(first._id)).toBe(String(second._id));
    const fires = await OrderModel.countDocuments({ restaurantId: diner.restaurantId, tableSessionId: session._id });
    expect(fires).toBe(1);
  });
});
