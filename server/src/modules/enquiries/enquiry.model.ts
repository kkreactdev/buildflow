import { Schema, model, type InferSchemaType } from 'mongoose';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../../core/scope/scopePlugin';
import { immutablePlugin } from '../../core/audit/immutable';

/**
 * An enquiry: one person's interest, handled by one branch and owned by one employee at a time.
 *
 * - Identity lives on the Person; `personName`/`phoneE164` are only a search projection (like Client).
 * - Masters are referenced by id (source, type, property/building type, location, lost reason); display
 *   always resolves them INCLUDING inactive values so history keeps its meaning.
 * - `stageCode` is the workflow stage `systemKey`; it changes ONLY through the workflow service.
 */
const enquirySchema = new Schema(
  {
    /** Human-facing id, e.g. ENQ-000042. Unique, never reused, from an atomic counter. */
    enquiryNo: { type: String, required: true, immutable: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    personName: { type: String, required: true },
    phoneE164: { type: String, required: true },

    sourceId: { type: Schema.Types.ObjectId, ref: 'Master' },
    typeId: { type: Schema.Types.ObjectId, ref: 'Master' },
    propertyTypeId: { type: Schema.Types.ObjectId, ref: 'Master' },
    buildingTypeId: { type: Schema.Types.ObjectId, ref: 'Master' },
    /** LOCATION master value of THIS enquiry's branch. */
    locationId: { type: Schema.Types.ObjectId, ref: 'Master' },

    stageCode: { type: String, required: true },
    stageChangedAt: { type: Date, required: true },
    /** Set while the enquiry is LOST; cleared on reopen (the history keeps it). */
    lostReasonId: { type: Schema.Types.ObjectId, ref: 'Master' },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },

    /** The referral this enquiry came through. Set and cleared only by the referral's controlled link operations. */
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral' },

    notes: { type: String, trim: true, maxlength: 2000 },
    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
enquirySchema.index({ enquiryNo: 1 }, { unique: true });
enquirySchema.index({ branchId: 1, isArchived: 1, stageCode: 1, stageChangedAt: -1 }); // board, stage counts, funnel
enquirySchema.index({ branchId: 1, isArchived: 1, createdAt: -1 });
enquirySchema.index({ assignedTo: 1, isArchived: 1, stageCode: 1 });
enquirySchema.index({ personId: 1 });
enquirySchema.index({ referralId: 1 }, { sparse: true });
enquirySchema.index({ branchId: 1, phoneE164: 1 });
enquirySchema.index({ branchId: 1, personName: 1 });
for (const f of ['sourceId', 'typeId', 'propertyTypeId', 'buildingTypeId', 'locationId', 'lostReasonId']) enquirySchema.index({ [f]: 1 }); // master reference checks + source/type reports
enquirySchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });

export type EnquiryDoc = InferSchemaType<typeof enquirySchema>;
export const Enquiry = model('Enquiry', enquirySchema);

/** Every stage movement, append-only. Funnels read "which stages did it reach" from here. */
const stageHistorySchema = new Schema(
  {
    enquiryId: { type: Schema.Types.ObjectId, required: true },
    branchId: { ...branchOwnedFields.branchId },
    /** Null for the initial entry created with the enquiry. */
    fromStage: { type: String },
    toStage: { type: String, required: true },
    direction: { type: String, enum: ['CREATE', 'FORWARD', 'BACKWARD', 'LOST', 'REOPEN'], required: true },
    reason: { type: String, trim: true },
    lostReasonId: { type: Schema.Types.ObjectId },
    userId: { type: Schema.Types.ObjectId },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
stageHistorySchema.index({ enquiryId: 1, at: 1 });
stageHistorySchema.index({ branchId: 1, toStage: 1, at: -1 });
stageHistorySchema.index({ lostReasonId: 1 }, { sparse: true });
stageHistorySchema.plugin(scopePlugin, { branchField: 'branchId' });
stageHistorySchema.plugin(immutablePlugin);
export const EnquiryStageHistory = model('EnquiryStageHistory', stageHistorySchema);

/** Who owned the enquiry when; never overwritten. */
const assignmentSchema = new Schema(
  {
    enquiryId: { type: Schema.Types.ObjectId, required: true },
    branchId: { ...branchOwnedFields.branchId },
    fromUserId: { type: Schema.Types.ObjectId },
    toUserId: { type: Schema.Types.ObjectId, required: true },
    byUserId: { type: Schema.Types.ObjectId },
    reason: { type: String, trim: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
assignmentSchema.index({ enquiryId: 1, at: 1 });
assignmentSchema.plugin(scopePlugin, { branchField: 'branchId' });
assignmentSchema.plugin(immutablePlugin);
export const EnquiryAssignment = model('EnquiryAssignment', assignmentSchema);
