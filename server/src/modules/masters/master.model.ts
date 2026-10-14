import { Schema, model, type InferSchemaType } from 'mongoose';
import { scopePlugin } from '../../core/scope/scopePlugin';
import { getMasterType } from './masterTypes';

const masterSchema = new Schema(
  {
    type: { type: String, required: true, immutable: true },
    /** Stable identifier within (type, branch). Immutable. */
    code: { type: String, required: true, immutable: true, trim: true, uppercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    sortOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, default: true },
    /** Set only on seeded values business code depends on. Immutable; such values cannot be deactivated or deleted. */
    systemKey: { type: String, immutable: true, uppercase: true, trim: true },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
    meta: { type: Schema.Types.Mixed },
    /** Present only for BRANCH-scoped types; absent = global. */
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', immutable: true },
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

// Unique per type (+ branch for branch-scoped types). Missing branchId counts as null, so global values are unique per type.
masterSchema.index({ type: 1, branchId: 1, code: 1 }, { unique: true });
masterSchema.index({ type: 1, systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } });
masterSchema.index({ type: 1, sortOrder: 1 });

masterSchema.pre('validate', function () {
  const def = getMasterType(this.type);
  if (!def) throw new Error(`Unknown master type "${this.type}"`);
  if (def.scope === 'BRANCH' && !this.branchId) this.invalidate('branchId', `${def.label} are branch-scoped and need a branch`);
  if (def.scope === 'GLOBAL' && this.branchId) this.invalidate('branchId', `${def.label} are global and cannot belong to a branch`);
});

// Global values are readable by everyone in scope but writable only by ALL scope (see ScopeSpec.shared).
masterSchema.plugin(scopePlugin, { branchField: 'branchId', shared: true });

export type MasterDoc = InferSchemaType<typeof masterSchema>;
export const Master = model('Master', masterSchema);
