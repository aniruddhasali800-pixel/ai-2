import { Router } from 'express';
import { z } from 'zod';
import { NotificationModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { ApiError } from '../../utils/httpError';
import { emit, Events } from '../../realtime/emit';
import { queryOf, zFlag } from '../../utils/query';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

const listQuerySchema = z.object({
  unreadOnly: zFlag.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

notificationsRouter.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = queryOf<ListQuery>(req);
    const query: Record<string, unknown> = { recipientId: req.auth!.userId };
    if (q.unreadOnly) query.readAt = null;

    const page = q.page ?? 1;
    const limit = q.limit ?? 30;
    const [data, total, unreadCount] = await Promise.all([
      NotificationModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      NotificationModel.countDocuments(query),
      NotificationModel.countDocuments({ recipientId: req.auth!.userId, readAt: null }),
    ]);
    res.json({ data, total, unreadCount, page, limit });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const result = await NotificationModel.updateMany(
      { recipientId: req.auth!.userId, readAt: null },
      { readAt: new Date() },
    );
    emit.toUser(req.auth!.userId, Events.NOTIFICATION, { readAll: true });
    res.json({ ok: true, marked: result.modifiedCount });
  }),
);

notificationsRouter.post(
  '/:id/read',
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const notification = await NotificationModel.findOneAndUpdate(
      { _id: req.params.id, recipientId: req.auth!.userId },
      { readAt: new Date() },
      { new: true },
    ).lean();
    if (!notification) throw ApiError.notFound('Notification not found');
    res.json(notification);
  }),
);

notificationsRouter.delete(
  '/:id',
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const result = await NotificationModel.deleteOne({ _id: req.params.id, recipientId: req.auth!.userId });
    if (!result.deletedCount) throw ApiError.notFound('Notification not found');
    res.json({ ok: true });
  }),
);
