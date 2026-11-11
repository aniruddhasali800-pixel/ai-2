import { Router } from 'express';
import { z } from 'zod';
import { AddonModel, CategoryModel, ProductModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { emit, Events } from '../../realtime/emit';
import { STATIONS } from '../../types/constants';
import { recordAudit } from '../../services/audit.service';

export const menuRouter = Router();

menuRouter.use(requireAuth);

function announce(restaurantId: string, reason: string) {
  emit.toRestaurant(restaurantId, Events.MENU_UPDATED, { reason });
}

/** Full menu bundle — single request keeps the POS and waiter app snappy. */
menuRouter.get(
  '/',
  requirePermission('menu:read'),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const [categories, products, addons] = await Promise.all([
      CategoryModel.find({ restaurantId }).sort({ sortOrder: 1, name: 1 }).lean(),
      ProductModel.find({ restaurantId }).sort({ sortOrder: 1, name: 1 }).lean(),
      AddonModel.find({ restaurantId }).sort({ name: 1 }).lean(),
    ]);
    res.json({ categories, products, addons });
  }),
);

const categorySchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(200).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

menuRouter.post(
  '/categories',
  requirePermission('menu:write'),
  validate({ body: categorySchema }),
  asyncHandler(async (req, res) => {
    const category = await CategoryModel.create({ ...req.body, restaurantId: req.auth!.restaurantId });
    announce(req.auth!.restaurantId, 'category.created');
    res.status(201).json(category.toObject());
  }),
);

menuRouter.patch(
  '/categories/:id',
  requirePermission('menu:write'),
  validate({ params: z.object({ id: z.string() }), body: categorySchema.partial() }),
  asyncHandler(async (req, res) => {
    const category = await CategoryModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.auth!.restaurantId },
      req.body,
      { new: true },
    ).lean();
    if (!category) throw ApiError.notFound('Category not found');
    announce(req.auth!.restaurantId, 'category.updated');
    res.json(category);
  }),
);

menuRouter.delete(
  '/categories/:id',
  requirePermission('menu:write'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const inUse = await ProductModel.countDocuments({ categoryId: req.params.id, restaurantId: req.auth!.restaurantId });
    if (inUse > 0) throw ApiError.conflict(`Move or remove the ${inUse} item(s) in this category first`);
    const deleted = await CategoryModel.findOneAndDelete({ _id: req.params.id, restaurantId: req.auth!.restaurantId }).lean();
    if (!deleted) throw ApiError.notFound('Category not found');
    announce(req.auth!.restaurantId, 'category.deleted');
    res.json({ ok: true });
  }),
);

const productSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(2).max(80),
  description: z.string().max(400).optional(),
  price: z.number().min(0).max(100000),
  imageUrl: z.string().max(500).optional(),
  taxPercent: z.number().min(0).max(28).nullable().optional(),
  isVeg: z.boolean().optional(),
  isActive: z.boolean().optional(),
  station: z.enum(STATIONS).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  prepMinutes: z.number().int().min(1).max(180).optional(),
  addonIds: z.array(z.string()).max(20).optional(),
  recipe: z
    .array(z.object({ inventoryItemId: z.string().min(1), qty: z.number().min(0).max(10000) }))
    .max(40)
    .optional(),
  tags: z.array(z.string().max(24)).max(12).optional(),
});

menuRouter.post(
  '/products',
  requirePermission('menu:write'),
  validate({ body: productSchema }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const category = await CategoryModel.findOne({ _id: req.body.categoryId, restaurantId }).lean();
    if (!category) throw ApiError.badRequest('Pick a category for this item');

    const product = await ProductModel.create({ ...req.body, restaurantId });
    announce(restaurantId, 'product.created');
    await recordAudit({
      restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'menu.product_created',
      entityType: 'Product',
      entityId: String(product._id),
      metadata: { name: product.name, price: product.price },
    });
    res.status(201).json(product.toObject());
  }),
);

menuRouter.patch(
  '/products/:id',
  requirePermission('menu:write'),
  validate({ params: z.object({ id: z.string() }), body: productSchema.partial() }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const before = await ProductModel.findOne({ _id: req.params.id, restaurantId }).lean();
    if (!before) throw ApiError.notFound('Menu item not found');

    const product = await ProductModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId },
      req.body,
      { new: true },
    ).lean();
    announce(restaurantId, 'product.updated');

    if (req.body.price !== undefined && req.body.price !== before.price) {
      await recordAudit({
        restaurantId,
        actorId: req.auth!.userId,
        actorName: req.auth!.name,
        action: 'menu.price_changed',
        entityType: 'Product',
        entityId: String(product!._id),
        metadata: { name: product!.name, from: before.price, to: product!.price },
      });
    }
    res.json(product);
  }),
);

menuRouter.delete(
  '/products/:id',
  requirePermission('menu:write'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const product = await ProductModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.auth!.restaurantId },
      { isActive: false },
      { new: true },
    ).lean();
    if (!product) throw ApiError.notFound('Menu item not found');
    announce(req.auth!.restaurantId, 'product.archived');
    res.json({ ok: true });
  }),
);

const addonSchema = z.object({
  name: z.string().min(1).max(60),
  price: z.number().min(0).max(10000),
  isActive: z.boolean().optional(),
});

menuRouter.post(
  '/addons',
  requirePermission('menu:write'),
  validate({ body: addonSchema }),
  asyncHandler(async (req, res) => {
    const addon = await AddonModel.create({ ...req.body, restaurantId: req.auth!.restaurantId });
    announce(req.auth!.restaurantId, 'addon.created');
    res.status(201).json(addon.toObject());
  }),
);

menuRouter.patch(
  '/addons/:id',
  requirePermission('menu:write'),
  validate({ params: z.object({ id: z.string() }), body: addonSchema.partial() }),
  asyncHandler(async (req, res) => {
    const addon = await AddonModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.auth!.restaurantId },
      req.body,
      { new: true },
    ).lean();
    if (!addon) throw ApiError.notFound('Add-on not found');
    announce(req.auth!.restaurantId, 'addon.updated');
    res.json(addon);
  }),
);
