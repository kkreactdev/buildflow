import { Schema, model, type InferSchemaType } from 'mongoose';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../../core/scope/scopePlugin';

/**
 * Client = a person's business relationship with ONE branch. The same person
 * can be a client of several branches: that is one Person and several Client
 * records, so each branch only ever sees (and can only leak) its own
 * relationship data, and normal branch scoping applies unchanged.
 *
 * `personName` / `phoneE164` are a denormalized SEARCH PROJECTION of the
 * Person (for branch-scoped search and sorting without joining into another
 * scoped collection). The Person stays authoritative; person.service rewrites
 * the projection whenever identity changes.
 */
const clientSchema = new Schema(
  {
    /** Human-facing id, e.g. CL-000042. Unique, generated from a counter. */
    clientNo: { type: String, required: true, immutable: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, immutable: true },
    /** A relationship belongs to exactly one branch for its whole life. */
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    personName: { type: String, required: true },
    phoneE164: { type: String, required: true },
    /** CLIENT_CATEGORY master value. Optional. */
    categoryId: { type: Schema.Types.ObjectId, ref: 'Master' },
    /** Relationship owner (employee). Under OWN scope users see only clients assigned to them. */
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Branch-specific notes (never stored on the Person). */
    notes: { type: String, trim: true, maxlength: 2000 },
    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
clientSchema.index({ clientNo: 1 }, { unique: true });
// One ACTIVE relationship per (person, branch); archived ones do not block a new one.
clientSchema.index({ personId: 1, branchId: 1 }, { unique: true, partialFilterExpression: { isArchived: false } });
clientSchema.index({ branchId: 1, isArchived: 1, personName: 1 });
clientSchema.index({ branchId: 1, phoneE164: 1 });
clientSchema.index({ branchId: 1, assignedTo: 1 });
clientSchema.index({ categoryId: 1 });
clientSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });

export type ClientDoc = InferSchemaType<typeof clientSchema>;
export const Client = model('Client', clientSchema);
