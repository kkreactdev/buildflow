import { Schema, model, type InferSchemaType } from 'mongoose';
import { scopePlugin } from '../../core/scope/scopePlugin';

const branchSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
branchSchema.index({ code: 1 }, { unique: true });
// A branch is its own scope: non-ALL actors only see branches in their list.
branchSchema.plugin(scopePlugin, { branchField: '_id' });

export type BranchDoc = InferSchemaType<typeof branchSchema>;
export const Branch = model('Branch', branchSchema);
