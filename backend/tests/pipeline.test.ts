// The aggregation stages the reports are written with, proven against the real schemas.
//
// These are the same stage lists src/services/report.service.ts passes to the models, so a failure
// here means a dashboard would have printed a wrong number rather than a missing engine feature.
import { Types } from 'mongoose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderModel, PaymentModel, TableSessionModel } from '../src/models';
import { connectTestDb, disconnectTestDb, makeDiner, makeRestaurant, makeUser, resetDb, type Diner } from './helpers';

let diner: Diner;

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
  diner = await makeDiner();
});
afterAll(disconnectTestDb);

/** A settled order, which is the only kind a revenue report is allowed to count. */
function order(over: Record<string, unknown> = {}) {
  return {
    restaurantId: diner.restaurantId,
    orderNumber: `O-${Math.floor(Math.random() * 1e9)}`,
    source: 'DINE_IN_QR',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    items: [{ name: 'Butter Chicken', price: 320, qty: 2, lineTotal: 640 }],
    subtotal: 640,
    taxTotal: 32,
    serviceCharge: 32,
    grandTotal: 704,
    placedAt: new Date('2026-10-13T12:00:00Z'),
    completedAt: new Date('2026-10-13T12:00:00Z'),
    ...over,
  };
}

describe('the stages a report is built from', () => {
  it('groups by the date the restaurant\'s own timezone reads', async () => {
    // 18:00 UTC on the 13th is 23:30 IST on the 13th, and 18:30 UTC is already the 14th there.
    await OrderModel.create(order({ grandTotal: 704, completedAt: new Date('2026-10-13T18:00:00Z') }));
    await OrderModel.create(order({ grandTotal: 96, completedAt: new Date('2026-10-13T18:30:00Z') }));
    await OrderModel.create(order({ grandTotal: 100, completedAt: new Date('2026-10-13T19:10:00Z') }));

    const rows = await OrderModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId), status: 'COMPLETED' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: 'Asia/Kolkata' } },
          orders: { $sum: 1 },
          revenue: { $sum: '$grandTotal' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    expect(rows).toEqual([
      { _id: '2026-10-13', orders: 1, revenue: 704 },
      { _id: '2026-10-14', orders: 2, revenue: 196 },
    ]);
  });

  it('buckets an order by the hour of the Indian night it was served in', async () => {
    await OrderModel.create(order({ completedAt: new Date('2026-10-13T18:30:00Z') }));
    await OrderModel.create(order({ completedAt: new Date('2026-10-13T06:05:00Z') }));

    const rows = await OrderModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId) } },
      { $group: { _id: { $hour: { date: '$completedAt', timezone: 'Asia/Kolkata' } }, revenue: { $sum: '$grandTotal' } } },
      { $sort: { _id: 1 } },
    ]);

    // Midnight IST reads as hour 0 on the platform that calls 00:00 "24", which the dashboard looks
    // up by number and would otherwise drop.
    expect(rows.map((row) => row._id)).toEqual([0, 11]);
  });

  it('folds six order sources into three channels with $switch', async () => {
    await OrderModel.create(order({ source: 'DINE_IN_WAITER', grandTotal: 500 }));
    await OrderModel.create(order({ source: 'ZOMATO', grandTotal: 300 }));
    await OrderModel.create(order({ source: 'WEBSITE', grandTotal: 100 }));

    const rows = await OrderModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId) } },
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $in: ['$source', ['DINE_IN_QR', 'DINE_IN_WAITER', 'CASHIER']] }, then: 'DINE_IN' },
                { case: { $in: ['$source', ['SWIGGY', 'ZOMATO', 'WEBSITE']] }, then: 'DELIVERY' },
              ],
              default: 'TAKEAWAY',
            },
          },
          revenue: { $sum: '$grandTotal' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
    ]);

    expect(rows).toEqual([
      { _id: 'DINE_IN', revenue: 500, orders: 1 },
      { _id: 'DELIVERY', revenue: 400, orders: 2 },
    ]);
  });

  it('unwinds the line items and totals each dish', async () => {
    await OrderModel.create(order({ items: [{ name: 'Cola', price: 90, qty: 3, lineTotal: 270 }, { name: 'Paneer', price: 330, qty: 1, lineTotal: 330 }] }));
    await OrderModel.create(order({ items: [{ name: 'Cola', price: 90, qty: 2, lineTotal: 180 }] }));

    const rows = await OrderModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId) } },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', qty: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { revenue: -1 } },
      { $limit: 2 },
    ]);

    expect(rows).toEqual([
      { _id: 'Cola', qty: 5, revenue: 450 },
      { _id: 'Paneer', qty: 1, revenue: 330 },
    ]);
  });

  it('joins a name onto a grouped id the way the waiter league does', async () => {
    const waiter = await makeUser(diner.restaurantId, 'WAITER', 'Sneha Test');
    await OrderModel.create(order({ waiterId: waiter._id, grandTotal: 704 }));
    await OrderModel.create(order({ waiterId: waiter._id, grandTotal: 96 }));

    const rows = await OrderModel.aggregate<{ _id: Types.ObjectId; orders: number; revenue: number; user: { name: string }[] }>([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId), waiterId: { $ne: null } } },
      { $group: { _id: '$waiterId', orders: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $sort: { revenue: -1 } },
    ]);

    expect(rows).toHaveLength(1);
    expect(String(rows[0]!._id)).toBe(String(waiter._id));
    expect(rows[0]!.orders).toBe(2);
    expect(rows[0]!.revenue).toBe(800);
    expect(rows[0]!.user[0]?.name).toBe('Sneha Test');
  });

  it('averages how long a table sat, one date minus another', async () => {
    await TableSessionModel.create({
      restaurantId: diner.restaurantId,
      tableId: diner.smallTableId,
      publicToken: 'token-a',
      status: 'CLOSED',
      openedAt: new Date('2026-10-13T12:00:00Z'),
      closedAt: new Date('2026-10-13T13:00:00Z'),
      guestCount: 2,
    });
    await TableSessionModel.create({
      restaurantId: diner.restaurantId,
      tableId: diner.largeTableId,
      publicToken: 'token-b',
      status: 'CLOSED',
      openedAt: new Date('2026-10-13T12:30:00Z'),
      closedAt: new Date('2026-10-13T14:00:00Z'),
      guestCount: 5,
    });

    const rows = await TableSessionModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId), status: 'CLOSED', closedAt: { $ne: null } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$openedAt', timezone: 'Asia/Kolkata' } },
          sessions: { $sum: 1 },
          guests: { $sum: '$guestCount' },
          avgMs: { $avg: { $subtract: ['$closedAt', '$openedAt'] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ _id: '2026-10-13', sessions: 2, guests: 7, avgMs: 4_500_000 });
    expect(Math.round(Number(rows[0]!.avgMs) / 60_000)).toBe(75);
  });

  it('sums refunds out of an unwound array and produces no row when nothing matched', async () => {
    await PaymentModel.create({
      restaurantId: diner.restaurantId,
      billId: new Types.ObjectId(),
      method: 'UPI',
      amount: 500,
      status: 'SUCCEEDED',
      refunds: [{ amount: 120, reason: 'A dish went back' }],
    });

    const refunded = await PaymentModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId) } },
      { $unwind: '$refunds' },
      { $group: { _id: null, refunded: { $sum: '$refunds.amount' } } },
    ]);
    expect(refunded).toEqual([{ _id: null, refunded: 120 }]);

    const none = await PaymentModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId() } },
      { $unwind: '$refunds' },
      { $group: { _id: null, refunded: { $sum: '$refunds.amount' } } },
    ]);
    // A report reads `rows[0]?.refunded ?? 0`, and no matching document means no row at all.
    expect(none).toEqual([]);
  });

  it('keeps a row whose join found nothing, the way the product report needs it', async () => {
    // An order line names a dish the menu no longer carries.
    await OrderModel.create(order({ items: [{ name: 'Old Special', price: 400, qty: 1, lineTotal: 400, productId: new Types.ObjectId() }] }));

    const rows = await OrderModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId) } },
      { $unwind: '$items' },
      { $group: { _id: { productId: '$items.productId', name: '$items.name' }, revenue: { $sum: '$items.lineTotal' } } },
      { $lookup: { from: 'products', localField: '_id.productId', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'categories', localField: 'product.categoryId', foreignField: '_id', as: 'category' } },
    ]);

    expect(rows).toHaveLength(1);
    expect((rows[0]!._id as { name: string }).name).toBe('Old Special');
    expect(rows[0]!.revenue).toBe(400);
    expect(rows[0]!.category).toEqual([]);
    expect(rows[0]!.product).toBeUndefined();
  });

  it('keeps one restaurant\'s orders out of another restaurant\'s report', async () => {
    const { restaurant } = await makeRestaurant();
    await OrderModel.create(order({ restaurantId: restaurant._id }));
    await OrderModel.create(order());

    const rows = await OrderModel.aggregate([
      { $match: { restaurantId: new Types.ObjectId(diner.restaurantId) } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
    ]);
    expect(rows).toEqual([{ _id: null, orders: 1, revenue: 704 }]);
  });

  it('refuses a stage it does not have rather than answering zero', async () => {
    await expect(OrderModel.aggregate([{ $facet: { a: [] } }])).rejects.toThrow(/has no aggregation stage \$facet/);
    await expect(OrderModel.aggregate([{ $group: { _id: null, x: { $stdDevPop: '$grandTotal' } } }])).rejects.toThrow(/no accumulation operator \$stdDevPop/);
    await expect(OrderModel.aggregate([{ $group: { _id: { $notARealOperator: 1 } } }])).rejects.toThrow(/cannot evaluate the expression \$notARealOperator/);
    await expect(OrderModel.aggregate([{ $lookup: { from: 'nowhere', localField: '_id', foreignField: '_id', as: 'x' } }])).rejects.toThrow(/is not a collection this store holds/);
  });

  it('hands out copies, so a report cannot write into the archive it is reading', async () => {
    await OrderModel.create(order({ grandTotal: 704 }));
    const rows = await OrderModel.aggregate([{ $match: { restaurantId: new Types.ObjectId(diner.restaurantId) } }]);
    rows[0]!.grandTotal = 999999;
    expect(await OrderModel.countDocuments({ grandTotal: 999999 })).toBe(0);
    expect(await OrderModel.countDocuments({ grandTotal: 704 })).toBe(1);
  });
});
