import { AuditLogModel } from '../models';

interface AuditInput {
  restaurantId: string;
  actorId?: string | null;
  actorName?: string;
  action: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string;
}

/** Audit trails must never break the action they describe. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await AuditLogModel.create({
      restaurantId: input.restaurantId,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? '',
      action: input.action,
      entityType: input.entityType ?? '',
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? null,
      ip: input.ip ?? '',
    });
  } catch (err) {
    console.error('[audit] failed to record', input.action, err);
  }
}
