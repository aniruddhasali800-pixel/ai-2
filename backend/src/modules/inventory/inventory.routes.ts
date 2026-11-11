import { Router } from 'express';
import { z } from 'zod';
import { InventoryItemModel, InventoryTransactionModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { emit, Events } from '../../realtime/emit';
import { adjustStock } from '../../services/inventory.service';
import { INVENTORY_TX_TYPES, INVENTORY_UNITS } from '../../types/constants';
import { queryOf, zFlag } from '../../utils/query';

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

const listQuerySchema = z.object({
  search: z.string().max(60).optional(),
  lowOnly: zFlag.optional(),
  includeInactive: zFlag.optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

const txQuerySchema = z.object({
  itemId: z.string().optional(),
  type: z.enum(INVENTORY_TX_TYPES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

type TxQuery = z.infer<typeof txQuerySchema>;

function isLow(item: { lowStockThreshold: number; stock: number }) {
  return item.lowStockThreshold > 0 && item.stock <= item.lowStockThreshold;
}

inventoryRouter.get(
  '/',
  requirePermission('inventory:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const q = queryOf<ListQuery>(req);
    const query: Record<string, unknown> = { restaurantId };
    if (!q.includeInactive) query.isActive = true;
    if (q.search) {
      query.name = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const items = await InventoryItemModel.find(query).sort({ name: 1 }).lean();
    const data = items.filter((item) => (q.lowOnly ? isLow(item) : true));
    res.json({
      data: data.map((item) => ({ ...item, isLow: isLow(item) })),
      summary: {
        items: items.length,
        lowStock: items.filter(isLow).length,
        stockValue: Math.round(items.reduce((sum, item) => sum + item.stock * item.costPerUnit, 0) * 100) / 100,
      },
    });
  }),
);

inventoryRouter.get(
  '/low-stock',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    const items = await InventoryItemModel.find({
      restaurantId: req.auth!.restaurantId,
      isActive: true,
      lowStockThreshold: { $gt: 0 },
      $expr: { $lte: ['$stock', '$lowStockThreshold'] },
    })
      .sort({ stock: 1 })
      .lean();
    res.json({ data: items.map((item) => ({ ...item, isLow: true })) });
  }),
);

inventoryRouter.get(
  '/transactions',
  requirePermission('inventory:read'),
  validate({ query: txQuerySchema }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const q = queryOf<TxQuery>(req);
    const query: Record<string, unknown> = { restaurantId };
    if (q.itemId) query.itemId = q.itemId;
    if (q.type) query.type = q.type;
    if (q.from || q.to) {
      query.createdAt = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    }

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [transactions, total] = await Promise.all([
      InventoryTransactionModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      InventoryTransactionModel.countDocuments(query),
    ]);

    const itemIds = [...new Set(transactions.map((t) => String(t.itemId)))];
    const items = itemIds.length ? await InventoryItemModel.find({ _id: { $in: itemIds } }).select('name unit').lean() : [];
    const itemById = new Map(items.map((i) => [String(i._id), i]));

    res.json({
      data: transactions.map((tx) => ({
        ...tx,
        itemName: itemById.get(String(tx.itemId))?.name ?? '—',
        unit: itemById.get(String(tx.itemId))?.unit ?? '',
      })),
      total,
      page,
      limit,
    });
  }),
);

inventoryRouter.post(
  '/',
  requirePermission('inventory:write'),
  validate({
    body: z.object({
      name: z.string().min(2).max(80),
      unit: z.enum(INVENTORY_UNITS).default('KG'),
      stock: z.number().min(0).max(1_000_000).optional(),
      lowStockThreshold: z.number().min(0).max(1_000_000).optional(),
      costPerUnit: z.number().min(0).max(1_000_000).optional(),
      supplier: z.string().max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const exists = await InventoryItemModel.findOne({ restaurantId, name: req.body.name }).lean();
    if (exists) throw ApiError.conflict(`"${req.body.name}" is already tracked in inventory`);

    const item = await InventoryItemModel.create({
      restaurantId,
      name: req.body.name,
      unit: req.body.unit,
      stock: req.body.stock ?? 0,
      lowStockThreshold: req.body.lowStockThreshold ?? 0,
      costPerUnit: req.body.costPerUnit ?? 0,
      supplier: req.body.supplier ?? '',
    });

    if (item.stock > 0) {
      await InventoryTransactionModel.create({
        restaurantId,
        itemId: item._id,
        type: 'RECEIPT',
        qty: item.stock,
        balanceAfter: item.stock,
        note: 'Opening stock',
        byUserId: req.auth!.userId,
      });
    }
    emit.toRestaurant(restaurantId, Events.INVENTORY_UPDATED, { itemId: String(item._id), stock: item.stock });
    res.status(201).json({ ...item.toObject(), isLow: isLow(item.toObject()) });
  }),
);

inventoryRouter.patch(
  '/:id',
  requirePermission('inventory:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      name: z.string().min(2).max(80).optional(),
      unit: z.enum(INVENTORY_UNITS).optional(),
      lowStockThreshold: z.number().min(0).max(1_000_000).optional(),
      costPerUnit: z.number().min(0).max(1_000_000).optional(),
      supplier: z.string().max(80).optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const item = await InventoryItemModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.auth!.restaurantId },
      req.body,
      { new: true },
    ).lean();
    if (!item) throw ApiError.notFound('Inventory item not found');
    emit.toRestaurant(req.auth!.restaurantId, Events.INVENTORY_UPDATED, { itemId: String(item._id), stock: item.stock });
    res.json({ ...item, isLow: isLow(item) });
  }),
);

inventoryRouter.delete(
  '/:id',
  requirePermission('inventory:write'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const item = await InventoryItemModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.auth!.restaurantId },
      { isActive: false },
      { new: true },
    ).lean();
    if (!item) throw ApiError.notFound('Inventory item not found');
    emit.toRestaurant(req.auth!.restaurantId, Events.INVENTORY_UPDATED, { itemId: String(item._id), removed: true });
    res.json({ ok: true, item });
  }),
);

inventoryRouter.post(
  '/:id/adjust',
  requirePermission('inventory:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      type: z.enum(INVENTORY_TX_TYPES),
      qty: z.number().positive().max(1_000_000),
      note: z.string().max(160).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const item = await adjustStock({
      restaurantId: req.auth!.restaurantId,
      itemId: req.params.id,
      type: req.body.type,
      qty: req.body.qty,
      note: req.body.note,
      actor: { userId: req.auth!.userId, name: req.auth!.name },
    });
    res.json({ ...item, isLow: isLow(item) });
  }),
);
