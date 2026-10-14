import { Schema, model, type InferSchemaType } from 'mongoose';
import { scopePlugin } from '../../core/scope/scopePlugin';

/**
 * Person = the company-wide IDENTITY of a human being, unique by normalized
 * phone. It is deliberately not owned by one branch: the same person may deal
 * with several branches without being duplicated.
 *
 * Visibility is derived from relationships: `branchIds` lists the branches in
 * which this person has an authorized business relationship (a client record
 * today; enquiries, visits and referrals as they arrive) or was explicitly
 * linked. A user sees a person only if one of those branches is in their scope
 * (the standard scope plugin on `branchIds`). There is no unrestricted person
 * search; the only cross-branch operations are existence-only phone checks and
 * explicit, audited linking, both via the `identity` system scope.
 *
 * Branch-specific data (category, notes, assignee) lives on the Client record,
 * never here, so nothing on a Person leaks business details across branches.
 */
const personSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Normalized E.164, the identity key. Unique at the database level. */
    phoneE164: { type: String, required: true, match: /^\+[1-9]\d{7,14}$/ },
    /** Display form of the same number. */
    phone: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    branchIds: { type: [Schema.Types.ObjectId], ref: 'Branch', default: [] },
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
personSchema.index({ phoneE164: 1 }, { unique: true });
personSchema.index({ branchIds: 1 });
personSchema.plugin(scopePlugin, { branchField: 'branchIds' });

export type PersonDoc = InferSchemaType<typeof personSchema>;
export const Person = model('Person', personSchema);
