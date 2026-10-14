import { Schema, model, type InferSchemaType } from 'mongoose';
import { immutablePlugin } from '../../core/audit/immutable';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../../core/scope/scopePlugin';

/**
 * A site visit: one scheduled trip with one person about one ENQUIRY, handled by one employee, to one or more units.
 *
 * - It always belongs to an existing enquiry; branch, person and numbers are taken from it, never from the request.
 * - Units are REFERENCES (`units[].unitId`, plus the immutable unit code for display/search). Unit data is never
 *   copied, and scheduling or completing never changes a unit's owner or status.
 * - `statusId` is a SITEVISIT_STATUS master; `statusKey` is its system key, always written with it. The status changes
 *   only through the lifecycle operations (complete / cancel), never a generic edit.
 * - `latitude`/`longitude` are the VISIT's location (a snapshot, optionally refined at completion); they never
 *   touch the units' own stored locations.
 * - `followUpId` records the single automatic next-day follow-up created at completion. The follow-up carries
 *   `siteVisitId` under a unique index, so a visit can never produce two even if completion is retried or races.
 */
const unitRefSchema = new Schema({ unitId: { type: Schema.Types.ObjectId, required: true }, unitCode: { type: String, required: true } }, { _id: false });

const siteVisitSchema = new Schema(
  {
    /** Human-facing id, e.g. SV-000042. Unique, immutable, never reused, from an atomic counter. */
    visitNo: { type: String, required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    enquiryId: { type: Schema.Types.ObjectId, ref: 'Enquiry', required: true, immutable: true },
    enquiryNo: { type: String, required: true, immutable: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, immutable: true },
    personName: { type: String, required: true },
    phoneE164: { type: String, required: true },
    /** Set when the person is already a client of this branch when the visit is scheduled. */
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', immutable: true },
    clientNo: { type: String, immutable: true },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date },

    scheduledAt: { type: Date, required: true },
    units: { type: [unitRefSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 2000 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },

    statusId: { type: Schema.Types.ObjectId, required: true },
    statusKey: { type: String, required: true },
    statusChangedAt: { type: Date, required: true },

    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId },
    feedback: { type: String, trim: true, maxlength: 3000 },
    completionNotes: { type: String, trim: true, maxlength: 2000 },
    followUpId: { type: Schema.Types.ObjectId },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId },
    cancelReason: { type: String, trim: true, maxlength: 300 },

    rescheduleCount: { type: Number, default: 0 },
    upcomingNotifiedAt: { type: Date },

    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
siteVisitSchema.index({ visitNo: 1 }, { unique: true });
siteVisitSchema.index({ branchId: 1, isArchived: 1, statusKey: 1, scheduledAt: 1 });
siteVisitSchema.index({ branchId: 1, isArchived: 1, scheduledAt: -1 });
siteVisitSchema.index({ assignedTo: 1, isArchived: 1, statusKey: 1, scheduledAt: 1 });
siteVisitSchema.index({ statusKey: 1, scheduledAt: 1 }); // the reminder sweep
siteVisitSchema.index({ enquiryId: 1, scheduledAt: -1 });
siteVisitSchema.index({ 'units.unitId': 1 });
siteVisitSchema.index({ personId: 1 });
siteVisitSchema.index({ statusId: 1 });
siteVisitSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });

export type SiteVisitDoc = InferSchemaType<typeof siteVisitSchema>;
export const SiteVisit = model('SiteVisit', siteVisitSchema);

/** Who was responsible for the visit when; never overwritten. */
const assignmentSchema = new Schema(
  {
    siteVisitId: { type: Schema.Types.ObjectId, required: true },
    branchId: { ...branchOwnedFields.branchId },
    fromUserId: { type: Schema.Types.ObjectId },
    toUserId: { type: Schema.Types.ObjectId, required: true },
    byUserId: { type: Schema.Types.ObjectId },
    reason: { type: String, trim: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
assignmentSchema.index({ siteVisitId: 1, at: 1 });
assignmentSchema.plugin(scopePlugin, { branchField: 'branchId' });
assignmentSchema.plugin(immutablePlugin);
export const SiteVisitAssignment = model('SiteVisitAssignment', assignmentSchema);
