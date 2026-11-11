import { InventoryItemModel, InventoryTransactionModel, NotificationModel, OrderModel, ProductModel } from '../models';
import { emit, Events } from '../realtime/emit';
import { ApiError } from '../utils/httpError';
import { notifyRoles } from './notification.service';
import { recordAudit } from './audit.service';
import type { InventoryTxType } from '../types/constants';

interface Actor {
  userId: string | null;
  name: string;
}

const LOW_STOCK_COOLDOWN_MS = 30 * 60_000;

async function applyDelta(restaurantId: string, itemId: string, delta: number) {
  return InventoryItemModel.findOneAndUpdate(
    { _id: itemId, restaurantId },
    [{ $set: { stock: { $max: [0, { $add: ['$stock', delta] }] } } }],
    { new: true },
  );
}

async function lowStockAlert(restaurantId: string, item: { _id: unknown; name: string; unit: string; stock: number; lowStockThreshold: number }) {
  if (item.lowStockThreshold <= 0 || item.stock > item.lowStockThreshold) return;

  const recent = await NotificationModel.findOne({
    restaurantId,
    type: 'LOW_STOCK',
    entityId: item._id as never,
    createdAt: { $gte: new Date(Date.now() - LOW_STOCK_COOLDOWN_MS) },
  }).lean();
  if (recent) return;

  emit.toRestaurant(restaurantId, Events.INVENTORY_LOW_STOCK, {
    itemId: String(item._id),
    name: item.name,
    stock: item.stock,
    unit: item.unit,
    threshold: item.lowStockThreshold,
  });
  await notifyRoles(restaurantId, ['OWNER', 'MANAGER'], {
    type: 'LOW_STOCK',
    title: `Low stock · ${item.name}`,
    body: `Only ${item.stock} ${item.unit.toLowerCase()} left (threshold ${item.lowStockThreshold} ${item.unit.toLowerCase()})`,
    entityType: 'InventoryItem',
    entityId: String(item._id),
  });
}

export async function adjustStock(opts: {
  restaurantId: string;
  itemId: string;
  type: InventoryTxType;
  qty: number;
  note?: string;
  actor: Actor;
}) {
  if (!(opts.qty > 0)) throw ApiError.badRequest('Quantity must be greater than zero');
  const item = await InventoryItemModel.findOne({ _id: opts.itemId, restaurantId: opts.restaurantId }).lean();
  if (!item) throw ApiError.notFound('Inventory item not found');

  const increase = opts.type === 'RECEIPT' || opts.type === 'RETURN';
  const delta = increase ? opts.qty : -opts.qty;
  const updated = await applyDelta(opts.restaurantId, opts.itemId, delta);
  if (!updated) throw ApiError.notFound('Inventory item not found');

  await InventoryTransactionModel.create({
    restaurantId: opts.restaurantId,
    itemId: updated._id,
    type: opts.type,
    qty: opts.qty,
    balanceAfter: updated.stock,
    note: opts.note ?? '',
    byUserId: opts.actor.userId,
  });

  emit.toRestaurant(opts.restaurantId, Events.INVENTORY_UPDATED, {
    itemId: String(updated._id),
    stock: updated.stock,
  });
  await lowStockAlert(opts.restaurantId, updated.toObject());
  await recordAudit({
    restaurantId: opts.restaurantId,
    actorId: opts.actor.userId,
    actorName: opts.actor.name,
    action: 'inventory.adjusted',
    entityType: 'InventoryItem',
    entityId: String(updated._id),
    metadata: { itemName: updated.name, type: opts.type, qty: opts.qty, balanceAfter: updated.stock, note: opts.note ?? '' },
  });

  return updated.toObject();
}

/** Deducts recipe quantities when an order completes. Idempotent per order. */
export async function deductForOrder(orderId: string, restaurantId: string, actorName: string) {
  const already = await InventoryTransactionModel.findOne({
    restaurantId,
    refOrderId: orderId,
    type: 'DEDUCTION',
  }).lean();
  if (already) return;

  const order = await OrderModel.findOne({ _id: orderId, restaurantId }).lean();
  if (!order) return;

  const productIds = order.items.map((i) => i.productId).filter(Boolean) as unknown as string[];
  if (!productIds.length) return;

  const products = await ProductModel.find({ _id: { $in: productIds }, restaurantId }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const needed = new Map<string, number>();
  for (const item of order.items) {
    const product = item.productId ? byId.get(String(item.productId)) : null;
    if (!product?.recipe?.length) continue;
    for (const line of product.recipe) {
      const key = String(line.inventoryItemId);
      needed.set(key, (needed.get(key) ?? 0) + line.qty * item.qty);
    }
  }
  if (!needed.size) return;

  for (const [itemId, qty] of needed) {
    const updated = await applyDelta(restaurantId, itemId, -qty);
    if (!updated) continue;
    await InventoryTransactionModel.create({
      restaurantId,
      itemId: updated._id,
      type: 'DEDUCTION',
      qty,
      balanceAfter: updated.stock,
      refOrderId: order._id,
      note: `Auto-deducted · Order ${order.orderNumber}`,
      byUserId: null,
    });
    await lowStockAlert(restaurantId, updated.toObject());
  }

  emit.toRestaurant(restaurantId, Events.INVENTORY_UPDATED, { reason: 'order-deduction', orderId });
  console.log(`[inventory] deducted stock for ${order.orderNumber} by ${actorName}`);
}
