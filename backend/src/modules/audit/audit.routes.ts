import { Router } from 'express';
import { z } from 'zod';
import { AuditLogModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { queryOf } from '../../utils/query';

export const auditRouter = Router();

auditRouter.use(requireAuth);

const listQuerySchema = z.object({
  action: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  actorId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

auditRouter.get(
  '/',
  requirePermission('audit:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const q = queryOf<ListQuery>(req);
    const query: Record<string, unknown> = { restaurantId };
    if (q.action) query.action = q.action;
    if (q.entityType) query.entityType = q.entityType;
    if (q.actorId) query.actorId = q.actorId;
    if (q.from || q.to) {
      query.createdAt = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    }

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const [data, total, actions] = await Promise.all([
      AuditLogModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLogModel.countDocuments(query),
      AuditLogModel.distinct('action', { restaurantId }),
    ]);

    res.json({ data, total, actions: (actions as string[]).sort(), page, limit });
  }),
);
