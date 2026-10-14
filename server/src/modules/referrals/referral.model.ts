import { Schema, model, type InferSchemaType } from 'mongoose';
import { immutablePlugin } from '../../core/audit/immutable';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../../core/scope/scopePlugin';

/**
 * A referral: a branch's record that a PERSON refers prospects to it. Identity is never copied here:
 *
 *   Person   = the global identity (name, phone, ...), owned by the persons module
 *   Client   = a person's relationship with one branch
 *   Referral = a person's standing as a referrer for one branch (this record)
 *
 * so one person can be all three without a duplicate Person. `personName`/`phoneE164` are only a search projection
 * (like Client and Enquiry), re-synced when the identity changes.
 *
 * The type (client / employee / external) is a REFERRAL_TYPE master chosen by the creation flow. A referral that came
 * from an existing client or employee keeps a pointer to that source. There is deliberately no status, commission,
 * percentage, payout or settlement: V1 only records who referred, and which enquiries they brought.
 *
 * One person has at most ONE non-archived referral per branch (partial unique index), so a retried or repeated
 * conversion can never create a second record. Archiving frees the slot.
 */
const referralSchema = new Schema(
  {
    /** Human-facing id, e.g. REF-000042. Unique, immutable, never reused, from an atomic counter. */
    referralNo: { type: String, required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, immutable: true },
    personName: { type: String, required: true },
    phoneE164: { type: String, required: true },

    /** REFERRAL_TYPE master value (CLIENT / EMPLOYEE / EXTERNAL by system key). */
    typeId: { type: Schema.Types.ObjectId, required: true, immutable: true },

    /** Present when the referral was made from an existing client / employee. */
    sourceClientId: { type: Schema.Types.ObjectId, ref: 'Client', immutable: true },
    sourceClientNo: { type: String, immutable: true },
    sourceUserId: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },

    /** Why / how this person came to be a referrer (free text, recorded at creation). */
    reason: { type: String, trim: true, maxlength: 300, immutable: true },
    notes: { type: String, trim: true, maxlength: 2000 },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },

    /** Enquiries brought by this referrer; each is linked through the controlled link operation (and carries `referralId`). */
    enquiryIds: { type: [Schema.Types.ObjectId], default: [] },

    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
referralSchema.index({ referralNo: 1 }, { unique: true });
referralSchema.index({ branchId: 1, personId: 1 }, { unique: true, partialFilterExpression: { isArchived: false }, name: 'one_active_referral_per_person_per_branch' });
referralSchema.index({ branchId: 1, isArchived: 1, createdAt: -1 });
referralSchema.index({ assignedTo: 1, isArchived: 1 });
referralSchema.index({ typeId: 1 });
referralSchema.index({ personId: 1 });
referralSchema.index({ enquiryIds: 1 });
referralSchema.index({ branchId: 1, personName: 1 });
referralSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });

export type ReferralDoc = InferSchemaType<typeof referralSchema>;
export const Referral = model('Referral', referralSchema);

/** Who looked after the referral when; never overwritten. */
const assignmentSchema = new Schema(
  {
    referralId: { type: Schema.Types.ObjectId, required: true },
    branchId: { ...branchOwnedFields.branchId },
    fromUserId: { type: Schema.Types.ObjectId },
    toUserId: { type: Schema.Types.ObjectId, required: true },
    byUserId: { type: Schema.Types.ObjectId },
    reason: { type: String, trim: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
assignmentSchema.index({ referralId: 1, at: 1 });
assignmentSchema.plugin(scopePlugin, { branchField: 'branchId' });
assignmentSchema.plugin(immutablePlugin);
export const ReferralAssignment = model('ReferralAssignment', assignmentSchema);
