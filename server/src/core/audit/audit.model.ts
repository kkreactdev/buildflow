import { Schema, model, type InferSchemaType } from 'mongoose';
import { scopePlugin } from '../scope/scopePlugin';
import { immutablePlugin } from './immutable';

const auditSchema = new Schema(
  {
    entityType: { type: String, required: true, trim: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    /** create | update | archive | restore | transition | assign | ... (free-form verb) */
    action: { type: String, required: true, trim: true },
    /** { field: { from, to } } — previous and new values; sensitive fields are redacted. */
    changes: { type: Schema.Types.Mixed, default: {} },
    userId: { type: Schema.Types.ObjectId },
    branchId: { type: Schema.Types.ObjectId },
    reason: { type: String, trim: true },
    requestId: { type: String },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

auditSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditSchema.index({ branchId: 1, at: -1 });
// Reads are branch-scoped (entries without a branch are visible to ALL scope only);
// the log is append-only for every caller.
auditSchema.plugin(scopePlugin, { branchField: 'branchId' });
auditSchema.plugin(immutablePlugin);

export type AuditDoc = InferSchemaType<typeof auditSchema>;
export const AuditLog = model('AuditLog', auditSchema);
