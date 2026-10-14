import { Schema, model, type InferSchemaType } from 'mongoose';
import { immutablePlugin } from '../audit/immutable';
import { scopePlugin } from '../scope/scopePlugin';

/** Entity kinds an activity can be attached to. Extend as modules arrive. */
export const ACTIVITY_REF_TYPES = [
  'enquiry',
  'client',
  'person',
  'unit',
  'sitevisit',
  'followup',
  'referral',
  'booking',
  'document',
  'user',
  'seller',
  'sellerProperty',
] as const;
export type ActivityRefType = (typeof ACTIVITY_REF_TYPES)[number];

const refSchema = new Schema(
  {
    type: { type: String, enum: ACTIVITY_REF_TYPES, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const activitySchema = new Schema(
  {
    /** `systemKey`/code of an ACTIVITY_TYPE master (validated by the service layer in Phase 3). */
    type: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    userId: { type: Schema.Types.ObjectId }, // absent for system-generated events
    /** Every business activity belongs to the branch where it happened (the scope boundary for reads). */
    branchId: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true, default: Date.now },
    refs: { type: [refSchema], validate: [(v: unknown[]) => v.length > 0, 'at least one ref is required'] },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One activity appears on the timeline of every entity it references.
activitySchema.index({ 'refs.type': 1, 'refs.id': 1, at: -1 });
activitySchema.index({ branchId: 1, at: -1 });
activitySchema.index({ type: 1, at: -1 });
activitySchema.plugin(scopePlugin, { branchField: 'branchId' });
activitySchema.plugin(immutablePlugin);

export type ActivityDoc = InferSchemaType<typeof activitySchema>;
export const Activity = model('Activity', activitySchema);
