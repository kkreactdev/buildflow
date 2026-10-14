import { Schema, model, type InferSchemaType } from 'mongoose';
import { softDeleteFields } from '../../core/scope/scopePlugin';

/**
 * A WhatsApp message template. Templates are COMPANY-WIDE, like the WhatsApp category and event masters they point to:
 * everyone allowed to see them sees the same list, and only an all-branches administrator may change them (same rule as every
 * global master). V1 stores templates only: nothing is ever sent from them and no provider is involved.
 *
 * - `categoryId` / `eventId` are masters (WA_CATEGORY / WA_EVENT); display resolves them INCLUDING inactive values, so a
 *   template keeps its meaning after a category or event is retired.
 * - `variables` is derived from `body` by the server (never trusted from the client) and always a subset of the code-defined
 *   allow-list (lib/templateVariables).
 * - A name is unique per event among non-archived templates (partial unique index), so a double submit cannot create twins.
 */
const templateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameKey: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true, maxlength: 1024 },
    variables: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
templateSchema.index({ eventId: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { isArchived: false }, name: 'one_active_template_name_per_event' });
templateSchema.index({ isArchived: 1, isActive: 1, createdAt: -1 });
templateSchema.index({ categoryId: 1 });

export type WhatsAppTemplateDoc = InferSchemaType<typeof templateSchema>;
export const WhatsAppTemplate = model('WhatsAppTemplate', templateSchema);
