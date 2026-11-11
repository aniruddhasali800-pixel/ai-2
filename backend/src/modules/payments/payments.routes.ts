import { Router } from 'express';
import { z } from 'zod';
import { PaymentModel, UserModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { refundPayment } from '../../services/billing.service';
import { captureMockPayment } from '../../services/mockCapture';
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '../../types/constants';
import { queryOf } from '../../utils/query';
import { billServiceRouter } from './billService.routes';

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);
// Registered before the /:id routes so the payment dashboard keeps its own paths.
paymentsRouter.use('/service', billServiceRouter);

const listQuerySchema = z.object({
  billId: z.string().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

paymentsRouter.get(
  '/',
  requirePermission('payments:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const q = queryOf<ListQuery>(req);
    const query: Record<string, unknown> = { restaurantId };
    if (q.billId) query.billId = q.billId;
    if (q.method) query.method = q.method;
    if (q.status) query.status = q.status;
    if (q.from || q.to) {
      query.createdAt = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    }

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total] = await Promise.all([
      PaymentModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PaymentModel.countDocuments(query),
    ]);

    const userIds = [...new Set(data.map((p) => String(p.collectedByUserId ?? '')).filter(Boolean))];
    const users = userIds.length ? await UserModel.find({ _id: { $in: userIds } }).select('name').lean() : [];
    const nameById = new Map(users.map((u) => [String(u._id), u.name]));

    res.json({
      data: data.map((payment) => ({
        ...payment,
        collectedByName: nameById.get(String(payment.collectedByUserId ?? '')) ?? null,
      })),
      total,
      page,
      limit,
    });
  }),
);

paymentsRouter.get(
  '/:id',
  requirePermission('payments:read'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const payment = await PaymentModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId }).lean();
    if (!payment) throw ApiError.notFound('Payment not found');
    res.json(payment);
  }),
);

paymentsRouter.post(
  '/:id/refund',
  requirePermission('payments:refund'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      amount: z.number().positive().max(1_000_000),
      reason: z.string().min(3).max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const payment = await refundPayment({
      restaurantId: req.auth!.restaurantId,
      paymentId: req.params.id,
      amount: req.body.amount,
      reason: req.body.reason,
      actor: { userId: req.auth!.userId, role: req.auth!.role, name: req.auth!.name },
    });
    res.json(payment);
  }),
);

/**
 * Sandbox checkout: proves the guest's tap still goes through the same
 * verified webhook path a real gateway would use. Only MOCK payments qualify,
 * so this can never settle a real Razorpay transaction.
 */
paymentsRouter.post(
  '/:id/simulate',
  requirePermission('payments:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      outcome: z.enum(['SUCCESS', 'FAILURE']).default('SUCCESS'),
      reason: z.string().max(160).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const payment = await PaymentModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId }).lean();
    if (!payment) throw ApiError.notFound('Payment not found');
    if (payment.status !== 'PENDING') {
      throw ApiError.conflict('This payment is no longer awaiting a gateway callback');
    }

    const result = await captureMockPayment({
      providerOrderId: payment.providerOrderId ?? '',
      provider: payment.provider,
      outcome: req.body.outcome,
      reason: req.body.reason,
    });

    res.json({ ok: true, outcome: req.body.outcome, message: result.message });
  }),
);
