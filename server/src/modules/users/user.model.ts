import { Schema, model, type InferSchemaType } from 'mongoose';
import { scopePlugin } from '../../core/scope/scopePlugin';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    /** Never selected by default; only the auth service opts in with `.select('+passwordHash')`. */
    passwordHash: { type: String, required: true, select: false },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    /** Branches this user belongs to. The effective data scope comes from the role. */
    branchIds: { type: [Schema.Types.ObjectId], ref: 'Branch', default: [] },
    primaryBranchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
    isActive: { type: Boolean, default: true },
    /** Incremented to invalidate every outstanding access token (deactivation, password reset). */
    tokenVersion: { type: Number, default: 0, select: false },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
    lastLoginAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ branchIds: 1 });
userSchema.index({ roleId: 1 });
// Visible by shared branch (BRANCH), or always to the user themself (OWN/BRANCH).
userSchema.plugin(scopePlugin, { branchField: 'branchIds', selfField: '_id' });

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
