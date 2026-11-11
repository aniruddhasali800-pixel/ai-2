import { Router } from 'express';
import { z } from 'zod';
import { OrderModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { addItemsToOrder, createOrder, getOrder, listOrders, transitionOrder } from '../../services/order.service';
import { ORDER_SOURCES, ORDER_STATUSES } from '../../types/constants';
import { pushOrderStatus } from '../../integrations/delivery';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.get(
  '/',
  requirePermission('orders:read'),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const result = await listOrders({
      restaurantId: req.auth!.restaurantId,
      status: q.status ? (q.status.split(',') as never) : undefined,
      source: q.source ? (q.source.split(',') as never) : undefined,
      tableId: q.tableId,
      sessionId: q.sessionId,
      activeOnly: q.active === 'true',
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      search: q.search,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    res.json(result);
  }),
);

ordersRouter.get(
  '/:id',
  requirePermission('orders:read'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.auth!.restaurantId, req.params.id);
    res.json(order);
  }),
);

const itemSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().min(1).max(99),
  addonIds: z.array(z.string()).max(20).optional(),
  notes: z.string().max(240).optional(),
});

const createSchema = z.object({
  source: z.enum(ORDER_SOURCES),
  tableId: z.string().nullable().optional(),
  tableSessionId: z.string().nullable().optional(),
  waiterId: z.string().nullable().optional(),
  customerName: z.string().max(80).optional(),
  customerPhone: z.string().max(20).optional(),
  customerAddress: z.string().max(160).optional(),
  customerCity: z.string().max(60).optional(),
  notes: z.string().max(400).optional(),
  items: z.array(itemSchema).min(1).max(60),
  discount: z
    .object({ type: z.enum(['PERCENT', 'FLAT']), value: z.number().min(0), note: z.string().max(120).optional() })
    .optional(),
});

ordersRouter.post(
  '/',
  requirePermission('orders:write'),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const order = await createOrder({
      ...req.body,
      restaurantId: auth.restaurantId,
      actor: { userId: auth.userId, role: auth.role, name: auth.name },
      waiterId: req.body.waiterId ?? (auth.role === 'WAITER' ? auth.userId : null),
      cashierId: auth.role === 'CASHIER' ? auth.userId : null,
    });
    res.status(201).json(order);
  }),
);

ordersRouter.post(
  '/:id/items',
  requirePermission('orders:write'),
  validate({ params: z.object({ id: z.string() }), body: z.object({ items: z.array(itemSchema).min(1).max(60) }) }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const order = await addItemsToOrder(auth.restaurantId, req.params.id, req.body.items, {
      userId: auth.userId,
      role: auth.role,
      name: auth.name,
    });
    res.json(order);
  }),
);

ordersRouter.patch(
  '/:id/status',
  requirePermission('orders:status'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      status: z.enum(ORDER_STATUSES),
      reason: z.string().max(200).optional(),
      riderName: z.string().max(60).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const order = await transitionOrder(
      auth.restaurantId,
      req.params.id,
      req.body.status,
      { userId: auth.userId, role: auth.role, name: auth.name },
      { reason: req.body.reason, riderName: req.body.riderName },
    );
    if (['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].includes(req.body.status)) {
      void pushOrderStatus({
        source: order.source,
        externalOrderId: order.externalOrderId ?? null,
        orderNumber: order.orderNumber,
        status: order.status,
      }).then((result) => {
        if (!result.pushed && order.externalOrderId) {
          console.log(`[delivery] status sync skipped for ${order.orderNumber}: ${result.detail}`);
        }
      });
    }
    res.json(order);
  }),
);

/** Order timeline for the detail drawers. */
ordersRouter.get(
  '/:id/timeline',
  requirePermission('orders:read'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const order = await OrderModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId })
      .select('orderNumber status statusHistory placedAt acceptedAt readyAt servedAt completedAt')
      .lean();
    if (!order) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    res.json(order);
  }),
);
