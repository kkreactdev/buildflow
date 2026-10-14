import { Schema, model, type InferSchemaType } from 'mongoose';
import { branchOwnedFields, scopePlugin } from '../../core/scope/scopePlugin';

/**
 * "This enquiry's person is considering this unit." It is its OWN record, deliberately separate from the three other
 * lifecycles it can be confused with:
 *  - the enquiry's workflow stage (where the lead is in the pipeline),
 *  - the unit's inventory status (Available / Booked / Sold ...),
 *  - the booking (an actual reservation, with its own ACTIVE / RELEASED states).
 * Recording interest changes none of them. Progress (site visit planned / completed, booked) is DERIVED from the real site
 * visits and bookings when read, so there is one source of truth; only INTERESTED / WITHDRAWN is stored here.
 *
 * The client is not stored: a client is the person in a branch, so the interest belongs to the enquiry (and its person) and
 * is reached from the client through that person. An enquiry can consider many units, and a unit many enquiries; one link per pair.
 */
const unitInterestSchema = new Schema(
  {
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', required: true, immutable: true },
    unitCode: { type: String, required: true, immutable: true },
    enquiryId: { type: Schema.Types.ObjectId, ref: 'Enquiry', required: true, immutable: true },
    enquiryNo: { type: String, required: true, immutable: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, immutable: true },
    status: { type: String, enum: ['INTERESTED', 'WITHDRAWN'], required: true, default: 'INTERESTED' },
    note: { type: String, trim: true, maxlength: 500 },
    withdrawnAt: { type: Date },
    withdrawnBy: { type: Schema.Types.ObjectId },
    withdrawReason: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
unitInterestSchema.index({ enquiryId: 1, unitId: 1 }, { unique: true }); // one link per enquiry and unit (a withdrawn one is reactivated, never duplicated)
unitInterestSchema.index({ unitId: 1, status: 1 });
unitInterestSchema.index({ personId: 1, branchId: 1 });
unitInterestSchema.plugin(scopePlugin, { branchField: 'branchId' });

export type UnitInterestDoc = InferSchemaType<typeof unitInterestSchema>;
export const UnitInterest = model('UnitInterest', unitInterestSchema);
