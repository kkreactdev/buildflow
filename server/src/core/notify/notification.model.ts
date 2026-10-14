import { Schema, model, type InferSchemaType } from 'mongoose';
import { scopePlugin } from '../scope/scopePlugin';

/**
 * One in-app notification for ONE recipient. Notifications are personal: every read path forces
 * `userId = the caller` on top of the branch scope, so not even an all-branches administrator can read
 * someone else's. `channel` leaves room for future delivery channels (email, push, WhatsApp) without a
 * schema change; only IN_APP exists today.
 */
const refSchema = new Schema({ type: { type: String, required: true }, id: { type: Schema.Types.ObjectId, required: true } }, { _id: false });

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    /** Key of NOTIFICATION_EVENTS. */
    eventCode: { type: String, required: true, immutable: true },
    channel: { type: String, enum: ['IN_APP'], default: 'IN_APP' },
    title: { type: String, required: true },
    body: { type: String },
    refs: { type: [refSchema], default: [] },
    readAt: { type: Date },
    /** Prevents the same event notifying the same person twice, even if a job runs again. Unique per recipient. */
    dedupeKey: { type: String, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
notificationSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'userId' });

export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export const Notification = model('Notification', notificationSchema);
