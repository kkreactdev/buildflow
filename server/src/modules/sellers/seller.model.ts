import { Schema, model, type InferSchemaType } from 'mongoose';
import { immutablePlugin } from '../../core/audit/immutable';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../../core/scope/scopePlugin';

/**
 * A SELLER: an owner offering land, a house or another property to the company. Identity is never
 * copied — `personId` points at the company-wide Person record, so one person can be an enquiry
 * party, a client and a seller without duplication. `personName`/`phoneE164` are a search projection
 * only (like Client and Enquiry), re-synced when the identity changes.
 *
 * The seller's own status tracks the RELATIONSHIP, not any single property: someone may be VERIFIED
 * as a seller while one of their properties sits in negotiation. Property state lives entirely on
 * SellerProperty, so one seller can offer many properties at different stages independently.
 */
const sellerSchema = new Schema(
  {
    /** Human-facing id, e.g. SEL-000042. Unique, immutable, never reused, from an atomic counter. */
    sellerNo: { type: String, required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, immutable: true },
    personName: { type: String, required: true },
    phoneE164: { type: String, required: true },

    /** SELLER_STATUS master, by id; the immutable system key is kept alongside for compare-and-set. */
    statusId: { type: Schema.Types.ObjectId, required: true },
    statusKey: { type: String, required: true },
    statusChangedAt: { type: Date, required: true },

    notes: { type: String, trim: true, maxlength: 2000 },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },

    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
sellerSchema.index({ sellerNo: 1 }, { unique: true });
sellerSchema.index({ branchId: 1, personId: 1 }, { unique: true, partialFilterExpression: { isArchived: false }, name: 'one_active_seller_per_person_per_branch' });
sellerSchema.index({ branchId: 1, isArchived: 1, statusKey: 1, createdAt: -1 });
sellerSchema.index({ assignedTo: 1, isArchived: 1, statusKey: 1 });
sellerSchema.index({ branchId: 1, personName: 1 });
sellerSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });

export type SellerDoc = InferSchemaType<typeof sellerSchema>;
export const Seller = model('Seller', sellerSchema);

/**
 * A property a SELLER proposes, held here BEFORE any Unit exists.
 *
 * This is deliberately NOT a Unit. A proposed property is an offer under evaluation: it must not
 * appear in inventory, must not be bookable, and must not be selectable by buyers. Only when a
 * purchase completes does the service create the Unit and stamp `unitId` here, so the proposed
 * record and the inventory record stay linked for the rest of the property's life.
 *
 * `unitId` is set exactly once and is the duplicate-prevention guard: a repeated purchase-completion
 * call finds it already populated and returns the same result rather than creating a second Unit.
 */
const propertySchema = new Schema(
  {
    sellerPropertyNo: { type: String, required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'Seller', required: true, immutable: true },
    sellerNo: { type: String, required: true, immutable: true },

    // ---- proposed details (the mapping source for the future Unit) ----
    name: { type: String, required: true, trim: true, maxlength: 150 },
    propertyTypeId: { type: Schema.Types.ObjectId },
    buildingTypeId: { type: Schema.Types.ObjectId },
    locationId: { type: Schema.Types.ObjectId },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    pincode: { type: String, trim: true, maxlength: 12 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    plotArea: { type: Number, min: 0 },
    builtUpArea: { type: Number, min: 0 },
    bedrooms: { type: Number, min: 0, max: 50 },
    bathrooms: { type: Number, min: 0, max: 50 },
    description: { type: String, trim: true, maxlength: 3000 },

    /** The seller's asking price for the proposed property, whole currency units. */
    askingPrice: { type: Number, min: 0 },
    /** Set once the purchase completes; equals the negotiated price paid. */
    purchasePrice: { type: Number, min: 0 },
    purchaseDate: { type: Date },
    /** Reference / document details captured at purchase (agreement number, registry reference, ...). */
    purchaseReference: { type: String, trim: true, maxlength: 300 },

    /** PROPERTY_STATUS master (id) plus the immutable system key for compare-and-set. */
    statusId: { type: Schema.Types.ObjectId, required: true },
    statusKey: { type: String, required: true },
    statusChangedAt: { type: Date, required: true },

    /**
     * The seller's assignee, kept in step with the seller (set at registration, rewritten in the same
     * transaction when the seller is reassigned). It exists so OWN-scope users see exactly the properties
     * of the sellers they handle: the scope layer filters on it like on any other owned record.
     */
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },

    /**
     * The Unit created when this property was purchased, stamped exactly once.
     *
     * Not marked `immutable` in the schema: Mongoose silently drops an immutable path from a `$set`
     * in findOneAndUpdate, and setting it is what creates the link in the first place. Set-once is
     * enforced by the write filter instead (`unitId: { $exists: false }` in the purchase operation),
     * which is the condition that actually matters — no other code path writes these fields.
     */
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit' },
    unitCode: { type: String },
    unitCreatedAt: { type: Date },

    /**
     * Development work summary, filled in while the property is in REFURBISHMENT. Every change is also
     * appended to SellerPropertyWork, so these fields show the current position and the log the path.
     * `workCompletedAt` being set is what Ready to Sell requires.
     */
    workNotes: { type: String, trim: true, maxlength: 2000 },
    workStartedAt: { type: Date },
    workCompletedAt: { type: Date },
    estimatedCost: { type: Number, min: 0 },
    actualCost: { type: Number, min: 0 },
    workAssignedTo: { type: Schema.Types.ObjectId, ref: 'User' },

    notes: { type: String, trim: true, maxlength: 2000 },

    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
propertySchema.index({ sellerPropertyNo: 1 }, { unique: true });
propertySchema.index({ branchId: 1, sellerId: 1, isArchived: 1, createdAt: -1 });
propertySchema.index({ branchId: 1, isArchived: 1, statusKey: 1, createdAt: -1 });
// One proposed property per Unit: the database refuses a second link even if the service guard were bypassed.
propertySchema.index({ unitId: 1 }, { unique: true, partialFilterExpression: { unitId: { $type: 'objectId' } }, name: 'one_property_per_unit' });
propertySchema.index({ assignedTo: 1, isArchived: 1, statusKey: 1 });
for (const f of ['propertyTypeId', 'buildingTypeId', 'locationId', 'statusId']) propertySchema.index({ [f]: 1 });
propertySchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });

export type SellerPropertyDoc = InferSchemaType<typeof propertySchema>;
export const SellerProperty = model('SellerProperty', propertySchema);

/**
 * One negotiation round: the seller's asking price, the company's offer, any counteroffer, the outcome.
 * Kept as an append-only list on the property so the full price discussion is preserved, never
 * overwritten by the next round.
 */
const negotiationSchema = new Schema(
  {
    sellerPropertyId: { type: Schema.Types.ObjectId, required: true },
    branchId: { ...branchOwnedFields.branchId },
    askingPrice: { type: Number, min: 0 },
    offeredPrice: { type: Number, min: 0 },
    counterPrice: { type: Number, min: 0 },
    /** AGREED / PENDING / DECLINED / WITHDRAWN, as recorded by the salesperson. */
    outcome: { type: String, required: true, enum: ['PENDING', 'AGREED', 'DECLINED', 'WITHDRAWN'] },
    notes: { type: String, trim: true, maxlength: 2000 },
    /** When the discussion took place, as reported (it may be logged later). `at` is when it was recorded. */
    discussedOn: { type: Date },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
negotiationSchema.index({ sellerPropertyId: 1, at: 1 });
negotiationSchema.plugin(scopePlugin, { branchField: 'branchId' });
negotiationSchema.plugin(immutablePlugin);
export const SellerPropertyNegotiation = model('SellerPropertyNegotiation', negotiationSchema);

/**
 * The single verification record for a proposed property: the checklist outcome, who verified it,
 * when, and any notes. One per property (enforced by a unique index), replaced by re-verification —
 * each replacement still appends a status-history row, so the earlier outcome is not lost.
 */
const verificationSchema = new Schema(
  {
    sellerPropertyId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId },
    /** PASSED / FAILED / PENDING, as recorded by the verifier. */
    outcome: { type: String, required: true, enum: ['PASSED', 'FAILED', 'PENDING'] },
    /** The checklist the verifier worked through, kept verbatim for audit. */
    checklist: {
      titleDeed: { type: String, enum: ['PENDING', 'PASSED', 'FAILED'], default: 'PENDING' },
      encumbrance: { type: String, enum: ['PENDING', 'PASSED', 'FAILED'], default: 'PENDING' },
      taxRecords: { type: String, enum: ['PENDING', 'PASSED', 'FAILED'], default: 'PENDING' },
      siteInspection: { type: String, enum: ['PENDING', 'PASSED', 'FAILED'], default: 'PENDING' },
      measurements: { type: String, enum: ['PENDING', 'PASSED', 'FAILED'], default: 'PENDING' },
    },
    verifiedById: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);
verificationSchema.index({ sellerPropertyId: 1 }, { unique: true });
verificationSchema.index({ branchId: 1, outcome: 1, verifiedAt: -1 });
verificationSchema.plugin(scopePlugin, { branchField: 'branchId' });
export const SellerPropertyVerification = model('SellerPropertyVerification', verificationSchema);

/**
 * Append-only refurbishment / development log: one row per start, progress update or completion, with the
 * notes, dates, responsible person and costs as recorded at that moment. The property carries the current
 * summary; this keeps how it got there.
 */
const workSchema = new Schema(
  {
    sellerPropertyId: { type: Schema.Types.ObjectId, required: true },
    branchId: { ...branchOwnedFields.branchId },
    unitId: { type: Schema.Types.ObjectId },
    kind: { type: String, required: true, enum: ['START', 'UPDATE', 'COMPLETE'] },
    notes: { type: String, trim: true, maxlength: 2000 },
    /** The business dates the work actually started / finished (may be earlier than the entry itself). */
    startedOn: { type: Date },
    completedOn: { type: Date },
    estimatedCost: { type: Number, min: 0 },
    actualCost: { type: Number, min: 0 },
    workAssignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
workSchema.index({ sellerPropertyId: 1, at: 1 });
workSchema.plugin(scopePlugin, { branchField: 'branchId' });
workSchema.plugin(immutablePlugin);
export const SellerPropertyWork = model('SellerPropertyWork', workSchema);

/** A pointer to another record touched by the same move (the seller, the person, the created unit…). */
const historyRefSchema = new Schema({ type: { type: String, required: true }, id: { type: Schema.Types.ObjectId, required: true } }, { _id: false });

/**
 * Immutable status history, on the same shape as EnquiryStageHistory: entity reference, previous and
 * new status, server timestamp, actor, reason, and the related records involved. Written inside the
 * same transaction as the transition, so history can never disagree with the state it describes.
 * `entityType` distinguishes the two histories this module owns without needing two collections.
 */

const statusHistorySchema = new Schema(
  {
    entityType: { type: String, required: true, enum: ['seller', 'sellerProperty'] },
    entityId: { type: Schema.Types.ObjectId, required: true },
    branchId: { ...branchOwnedFields.branchId },
    /** Null for the initial entry created with the record. */
    fromStatus: { type: String },
    toStatus: { type: String, required: true },
    /** Which operation caused it (registered, verified, approved, purchased, …). */
    action: { type: String, required: true },
    reason: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    /** The other records touched by this move, so a timeline can show the whole picture. */
    refs: { type: [historyRefSchema], default: [] },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
statusHistorySchema.index({ entityType: 1, entityId: 1, at: 1 });
statusHistorySchema.index({ branchId: 1, entityType: 1, toStatus: 1, at: -1 });
statusHistorySchema.index({ branchId: 1, at: -1 });
statusHistorySchema.plugin(scopePlugin, { branchField: 'branchId' });
statusHistorySchema.plugin(immutablePlugin);
export const SellerStatusHistory = model('SellerStatusHistory', statusHistorySchema);