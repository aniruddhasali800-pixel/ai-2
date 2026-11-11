import { NotificationModel, UserModel } from '../models';
import { emit, Events } from '../realtime/emit';
import type { NotificationType, Role } from '../types/constants';

interface NotifyInput {
  restaurantId: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

export async function notify(input: NotifyInput) {
  const doc = await NotificationModel.create({
    restaurantId: input.restaurantId,
    recipientId: input.recipientId,
    type: input.type,
    title: input.title,
    body: input.body ?? '',
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    data: input.data ?? null,
  });
  emit.toUser(input.recipientId, Events.NOTIFICATION, {
    _id: String(doc._id),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    entityType: doc.entityType,
    entityId: doc.entityId ? String(doc.entityId) : null,
    data: doc.data,
    createdAt: doc.createdAt,
  });
  return doc;
}

export async function notifyRoles(
  restaurantId: string,
  roles: Role[],
  input: Omit<NotifyInput, 'restaurantId' | 'recipientId'>,
): Promise<void> {
  const users = await UserModel.find({ restaurantId, role: { $in: roles }, status: 'ACTIVE' })
    .select('_id')
    .lean();
  await Promise.all(users.map((u) => notify({ ...input, restaurantId, recipientId: String(u._id) })));
}
