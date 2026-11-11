import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { defineModel } from '../store';
import { NOTIFICATION_TYPES } from '../types/constants';

const notificationSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    data: { type: Schema.Types.Mixed, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, readAt: 1 });

export type Notification = InferSchemaType<typeof notificationSchema>;
export const NotificationModel = defineModel('Notification', notificationSchema) as unknown as Model<Notification>;
