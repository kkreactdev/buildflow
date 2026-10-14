import { Schema, model, type InferSchemaType } from 'mongoose';

export const DATA_SCOPES = ['ALL', 'BRANCH', 'OWN'] as const;

const roleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Stable machine key (e.g. SUPER_ADMIN). Never used for authorization decisions. */
    key: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, trim: true },
    /** Permission keys from the catalog, or '*' (only the seeded Super Admin). */
    permissions: { type: [String], default: [] },
    dataScope: { type: String, enum: DATA_SCOPES, required: true, default: 'OWN' },
    /** System roles are seeded, cannot be deleted, and Super Admin's grants are locked. */
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
roleSchema.index({ key: 1 }, { unique: true });
roleSchema.index({ name: 1 }, { unique: true });

export type RoleDoc = InferSchemaType<typeof roleSchema>;
export const Role = model('Role', roleSchema);
