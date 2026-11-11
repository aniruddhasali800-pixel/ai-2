import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';

const auditLogSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '' },
    action: { type: String, required: true },
    entityType: { type: String, default: '' },
    entityId: { type: Schema.Types.ObjectId, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: '' },
  },
  { timestamps: true },
);

auditLogSchema.index({ restaurantId: 1, createdAt: -1 });
auditLogSchema.index({ restaurantId: 1, action: 1, createdAt: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = defineModel('AuditLog', auditLogSchema) as unknown as Model<AuditLog>;
