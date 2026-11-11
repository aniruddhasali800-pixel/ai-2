import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { env } from '../../config/env';
import {
  createBill,
  getBill,
  listBills,
  markBillPrinted,
  recordCashPayment,
  startOnlinePayment,
} from '../../services/billing.service';
import { queryOf, zFlag } from '../../utils/query';

export const billingRouter = Router();

billingRouter.use(requireAuth);

const listQuerySchema = z.object({
  unpaidOnly: zFlag.optional(),
  todayOnly: zFlag.optional(),
  search: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

/** Issues the final bill for a table session (or a single order), server-computed. */
billingRouter.post(
  '/',
  requirePermission('billing:write'),
  validate({
    body: z
      .object({
        sessionId: z.string().optional(),
        orderId: z.string().optional(),
      })
      .refine((body) => Boolean(body.sessionId) !== Boolean(body.orderId), {
        message: 'Provide either the table session or an order to bill',
      }),
  }),
  asyncHandler(async (req, res) => {
    const bill = await createBill({
      restaurantId: req.auth!.restaurantId,
      actor: { userId: req.auth!.userId, role: req.auth!.role, name: req.auth!.name },
      sessionId: req.body.sessionId,
      orderId: req.body.orderId,
    });
    res.status(201).json({
      bill,
      publicUrl: `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/bill/${bill.publicToken}`,
    });
  }),
);

billingRouter.get(
  '/',
  requirePermission('billing:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = queryOf<ListQuery>(req);
    const result = await listBills(req.auth!.restaurantId, {
      unpaidOnly: q.unpaidOnly,
      todayOnly: q.todayOnly,
      search: q.search,
      page: q.page,
      limit: q.limit,
    });
    res.json(result);
  }),
);

billingRouter.get(
  '/:id',
  requirePermission('billing:read'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const result = await getBill(req.auth!.restaurantId, req.params.id);
    res.json({
      ...result,
      publicUrl: `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/bill/${result.bill.publicToken}`,
    });
  }),
);

/** Cash drawer settlement — records change due and notifies the floor instantly. */
billingRouter.post(
  '/:id/cash',
  requirePermission('payments:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      tendered: z.number().min(0).max(1_000_000).optional(),
      note: z.string().max(160).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await recordCashPayment({
      restaurantId: req.auth!.restaurantId,
      billId: req.params.id,
      actor: { userId: req.auth!.userId, role: req.auth!.role, name: req.auth!.name },
      tendered: req.body.tendered,
      note: req.body.note,
    });
    res.json(result);
  }),
);

/** Creates a gateway intent for card / UPI / online payment. */
billingRouter.post(
  '/:id/online',
  requirePermission('payments:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      method: z.enum(['CARD', 'UPI', 'ONLINE']),
      provider: z.string().max(24).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const payment = await startOnlinePayment({
      restaurantId: req.auth!.restaurantId,
      billId: req.params.id,
      actor: { userId: req.auth!.userId, role: req.auth!.role, name: req.auth!.name },
      method: req.body.method,
      provider: req.body.provider,
    });
    res.status(201).json(payment);
  }),
);

/** Marks the bill as printed and bumps the print counter. */
billingRouter.post(
  '/:id/print',
  requirePermission('billing:read'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const bill = await markBillPrinted(req.auth!.restaurantId, req.params.id);
    res.json(bill);
  }),
);
