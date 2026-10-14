import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Enquiry pipeline configuration (company-wide, so not branch-scoped).
 * `systemKey`, `kind` and `isSystem` are immutable; `entryPolicy` and
 * `domainOperation` are system-managed (never editable through the API).
 */
const stageSchema = new Schema(
  {
    systemKey: { type: String, required: true, immutable: true, uppercase: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
    /** Position in the FLOW chain (1..n). LOST is outside the chain. */
    order: { type: Number, required: true },
    kind: { type: String, enum: ['FLOW', 'LOST'], required: true, immutable: true },
    entryPolicy: { type: String, enum: ['MANUAL', 'DOMAIN'], default: 'MANUAL' },
    domainOperation: { type: String },
    isSystem: { type: Boolean, default: false, immutable: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
stageSchema.index({ systemKey: 1 }, { unique: true });
stageSchema.index({ kind: 1, order: 1 });

export type WorkflowStageDoc = InferSchemaType<typeof stageSchema>;
export const WorkflowStage = model('WorkflowStage', stageSchema);
