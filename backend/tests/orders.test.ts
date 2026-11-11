import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, makeDiner, resetDb } from './helpers';
import { createOrder, transitionOrder } from '../src/services/order.service';
import { InventoryItemModel, InventoryTransactionModel } from '../src/models';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

const actor = (userId: string, role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | 'WAITER', name: string) => ({
  userId,
  role,
  name,
});

describe('order creation', () => {
  it('computes totals from the menu, never from the client', async () => {
    const diner = await makeDiner();
    const order = await createOrder({
      restaurantId: diner.restaurantId,
      source: 'DINE_IN_WAITER',
      items: [{ productId: diner.mainsProductId, qty: 2 }],
      actor: actor(diner.waiterId, 'WAITER', 'Sneha'),
    });

    expect(order.subtotal).toBe(640);
    expect(order.taxTotal).toBe(32);
    expect(order.serviceCharge).toBe(32);
    expect(order.grandTotal).toBe(704);
    expect(order.status).toBe('PLACED');
    expect(order.orderNumber).toMatch(/^D-\d{3}$/);
    expect(order.items[0]).toMatchObject({ name: 'Butter Chicken', price: 320, qty: 2, taxPercent: 5 });
  });

  it('numbers orders sequentially within the day', async () => {
    const diner = await makeDiner();
    const first = await createOrder({
      restaurantId: diner.restaurantId,
      source: 'DINE_IN_WAITER',
      items: [{ productId: diner.colaProductId, qty: 1 }],
    });
    const second = await createOrder({
      restaurantId: diner.restaurantId,
      source: 'DINE_IN_WAITER',
      items: [{ productId: diner.colaProductId, qty: 1 }],
    });
    expect([first.orderNumber, second.orderNumber]).toEqual(['D-001', 'D-002']);
  });

  it('refuses items that left the menu and absurd quantities', async () => {
    const diner = await makeDiner();
    await expect(
      createOrder({
        restaurantId: diner.restaurantId,
        source: 'DINE_IN_WAITER',
        items: [{ productId: '64b7f1c2a1b2c3d4e5f60718', qty: 1 }],
      }),
    ).rejects.toThrow(/no longer on the menu/);

    await expect(
      createOrder({
        restaurantId: diner.restaurantId,
        source: 'DINE_IN_WAITER',
        items: [{ productId: diner.mainsProductId, qty: 120 }],
      }),
    ).rejects.toThrow(/between 1 and 99/);
  });

  it('serves another tenant nothing', async () => {
    const a = await makeDiner();
    const b = await makeDiner();
    await expect(
      createOrder({ restaurantId: b.restaurantId, source: 'DINE_IN_WAITER', items: [{ productId: a.mainsProductId, qty: 1 }] }),
    ).rejects.toThrow(/no longer on the menu/);
  });
});

describe('order state machine', () => {
  async function placedOrder() {
    const diner = await makeDiner();
    const order = await createOrder({
      restaurantId: diner.restaurantId,
      source: 'DINE_IN_WAITER',
      items: [{ productId: diner.mainsProductId, qty: 1 }],
    });
    return { diner, order };
  }

  it('blocks illegal jumps between statuses', async () => {
    const { diner, order } = await placedOrder();
    await expect(
      transitionOrder(diner.restaurantId, String(order._id), 'SERVED', actor(diner.waiterId, 'WAITER', 'Sneha')),
    ).rejects.toThrow(/Cannot move an order from PLACED to SERVED/);
  });

  it('enforces which role may move an order into a status', async () => {
    const { diner, order } = await placedOrder();
    await transitionOrder(diner.restaurantId, String(order._id), 'ACCEPTED', actor(diner.kitchenId, 'KITCHEN', 'Vikram'));
    await expect(
      transitionOrder(diner.restaurantId, String(order._id), 'PREPARING', actor(diner.cashierId, 'CASHIER', 'Rohit')),
    ).rejects.toThrow(/cannot mark an order as preparing/);
  });

  it('walks a dine-in order to completion and deducts recipe stock once', async () => {
    const { diner, order } = await placedOrder();
    const kitchen = actor(diner.kitchenId, 'KITCHEN', 'Vikram');
    const waiter = actor(diner.waiterId, 'WAITER', 'Sneha');
    const cashier = actor(diner.cashierId, 'CASHIER', 'Rohit');

    await transitionOrder(diner.restaurantId, String(order._id), 'ACCEPTED', kitchen);
    await transitionOrder(diner.restaurantId, String(order._id), 'PREPARING', kitchen);
    await transitionOrder(diner.restaurantId, String(order._id), 'READY', kitchen);
    await transitionOrder(diner.restaurantId, String(order._id), 'SERVED', waiter);
    const completed = await transitionOrder(diner.restaurantId, String(order._id), 'COMPLETED', cashier);

    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toBeTruthy();

    const item = await InventoryItemModel.findById(diner.flourItemId).lean();
    expect(item?.stock).toBe(19.75);
    const deductions = await InventoryTransactionModel.find({ refOrderId: order._id, type: 'DEDUCTION' }).lean();
    expect(deductions).toHaveLength(1);
    expect(deductions[0].qty).toBe(0.25);
    expect(deductions[0].balanceAfter).toBe(19.75);

    // Re-completing is a no-op; moving a closed order anywhere else is a conflict.
    const again = await transitionOrder(diner.restaurantId, String(order._id), 'COMPLETED', cashier);
    expect(again.status).toBe('COMPLETED');
    await expect(
      transitionOrder(diner.restaurantId, String(order._id), 'SERVED', waiter),
    ).rejects.toThrow(/already completed/);
    const { deductForOrder } = await import('../src/services/inventory.service');
    await deductForOrder(String(order._id), diner.restaurantId, 'test');
    const after = await InventoryItemModel.findById(diner.flourItemId).lean();
    expect(after?.stock).toBe(19.75);
  });
});
