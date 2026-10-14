import { Schema, model, type InferSchemaType } from 'mongoose';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../../core/scope/scopePlugin';

/**
 * A follow-up: a piece of work for one person, about one enquiry OR one client OR one seller, due at a time.
 * A seller follow-up may also name the proposed property it is about (a call, a site inspection, a price
 * discussion); `sellerPropertyId` is then set alongside `sellerId`, never instead of it.
 *
 * - Branch-scoped; `assignedTo` is the OWN-scope owner. The branch is taken from the enquiry/client it
 *   hangs off, never from the request.
 * - `typeId` / `statusId` are masters. `statusKey` is the status' immutable system key, kept beside the
 *   id so jobs and dashboards query on a stable key (it is always written together with `statusId`).
 * - `personName`/`phoneE164`/`enquiryNo`/`clientNo` are display/search projections (numbers never change;
 *   name and phone are re-synced when the person's identity changes).
 * - Completing a follow-up never creates another one: the next is scheduled explicitly.
 */
const followupSchema = new Schema(
  {
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, immutable: true },
    personName: { type: String, required: true },
    phoneE164: { type: String, required: true },
    enquiryId: { type: Schema.Types.ObjectId, ref: 'Enquiry', immutable: true },
    enquiryNo: { type: String, immutable: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', immutable: true },
    clientNo: { type: String, immutable: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', immutable: true },
    sellerNo: { type: String, immutable: true },
    sellerPropertyId: { type: Schema.Types.ObjectId, ref: 'SellerProperty', immutable: true },
    sellerPropertyNo: { type: String, immutable: true },

    /** Set only on the follow-up created automatically when a site visit is completed; unique, so a visit can never produce two. */
    siteVisitId: { type: Schema.Types.ObjectId, immutable: true },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    typeId: { type: Schema.Types.ObjectId, ref: 'Master', required: true },
    statusId: { type: Schema.Types.ObjectId, ref: 'Master', required: true },
    statusKey: { type: String, required: true },
    scheduledAt: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 2000 },

    rescheduleCount: { type: Number, default: 0 },
    missedAt: { type: Date },
    upcomingNotifiedAt: { type: Date },
    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId },
    outcome: { type: String, trim: true, maxlength: 1000 },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId },
    cancelReason: { type: String, trim: true, maxlength: 300 },

    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

followupSchema.pre('validate', function () {
  const anchors = [this.enquiryId, this.clientId, this.sellerId].filter(Boolean).length;
  if (anchors !== 1) this.invalidate('enquiryId', 'A follow-up belongs to exactly one enquiry, client or seller');
  if (this.sellerPropertyId && !this.sellerId) this.invalidate('sellerPropertyId', 'A property follow-up also names its seller');
});

followupSchema.index({ branchId: 1, isArchived: 1, statusKey: 1, scheduledAt: 1 }); // today / missed / upcoming lists and counts
followupSchema.index({ assignedTo: 1, isArchived: 1, statusKey: 1, scheduledAt: 1 }); // "my" follow-ups
followupSchema.index({ statusKey: 1, scheduledAt: 1 }); // the jobs' sweeps
followupSchema.index({ enquiryId: 1, scheduledAt: -1 }, { sparse: true });
followupSchema.index({ clientId: 1, scheduledAt: -1 }, { sparse: true });
followupSchema.index({ sellerId: 1, scheduledAt: -1 }, { sparse: true });
followupSchema.index({ sellerPropertyId: 1, scheduledAt: -1 }, { sparse: true });
followupSchema.index({ siteVisitId: 1 }, { unique: true, partialFilterExpression: { siteVisitId: { $type: 'objectId' } } });
followupSchema.index({ personId: 1 });
followupSchema.index({ typeId: 1 });
followupSchema.index({ statusId: 1 });
followupSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });

export type FollowUpDoc = InferSchemaType<typeof followupSchema>;
export const FollowUp = model('FollowUp', followupSchema);
