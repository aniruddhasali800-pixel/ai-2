import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { kitchenQueue, transitionOrder } from '../../services/order.service';
import { OrderModel } from '../../models';
import { pushOrderStatus } from '../../integrations/delivery';
import type { OrderStatus } from '../../types/constants';

export const kitchenRouter = Router();

kitchenRouter.use(requireAuth, requirePermission('kitchen:operate'));

kitchenRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const orders = await kitchenQueue(req.auth!.restaurantId);
    res.json({ data: orders });
  }),
);

/** Explicit KDS actions — the transition guards still live in one place. */
kitchenRouter.patch(
  '/orders/:id/status',
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({ status: z.enum(['ACCEPTED', 'PREPARING', 'READY']), reason: z.string().max(200).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const order = await transitionOrder(
      auth.restaurantId,
      req.params.id,
      req.body.status as OrderStatus,
      { userId: auth.userId, role: auth.role, name: auth.name },
      { reason: req.body.reason },
    );
    void pushOrderStatus({
      source: order.source,
      externalOrderId: order.externalOrderId ?? null,
      orderNumber: order.orderNumber,
      status: order.status,
    });
    res.json(order);
  }),
);

/** Station filters keep the board focused (grill, tandoor, bar…). */
kitchenRouter.get(
  '/board',
  validate({ query: z.object({ station: z.string().max(20).optional() }) }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const orders = await kitchenQueue(restaurantId);
    if (!req.query.station) return void res.json({ data: orders });

    const filtered = orders
      .map((order) => ({
        ...order,
        items: order.items.filter((item) => item.station === req.query.station),
      }))
      .filter((order) => order.items.length > 0);
    res.json({ data: filtered });
  }),
);

kitchenRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [pending, preparing, ready, completedToday] = await Promise.all([
      OrderModel.countDocuments({ restaurantId, status: 'PLACED' }),
      OrderModel.countDocuments({ restaurantId, status: { $in: ['ACCEPTED', 'PREPARING'] } }),
      OrderModel.countDocuments({ restaurantId, status: 'READY' }),
      OrderModel.countDocuments({ restaurantId, status: 'COMPLETED', completedAt: { $gte: startOfDay } }),
    ]);
    res.json({ pending, preparing, ready, completedToday });
  }),
);
