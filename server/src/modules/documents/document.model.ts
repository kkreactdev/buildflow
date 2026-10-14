import { Schema, model, type InferSchemaType } from 'mongoose';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../../core/scope/scopePlugin';
import { DOCUMENT_ENTITY_TYPES } from './document.entities';

/**
 * A business document: ONE file (with its replaced versions kept as history) attached to ONE business record.
 *
 * - The branch, entity type/id and entity number are fixed at creation and come from the record itself, never from the request.
 * - Access is the record's access: see document.service (`accessible`). The file lives in PRIVATE storage; its storage key is
 *   never returned by any API, and a download link is generated per request, short-lived, after the check. No URL is stored.
 * - `contentHash` (SHA-256 of the bytes) makes a repeated upload of the same file to the same record impossible while the
 *   first is active (partial unique index): a double click or a retry cannot create two documents.
 * - Replacing a file moves the old one into `previousFiles` (never deleted, so history and audit stay meaningful) and is a
 *   compare-and-set on `fileVersion`, so two simultaneous replacements cannot both win.
 */
const fileSchema = new Schema(
  {
    version: { type: Number, required: true },
    publicId: { type: String, required: true },
    format: { type: String, required: true, enum: ['jpg', 'png', 'webp', 'pdf'] },
    mime: { type: String, required: true },
    bytes: { type: Number, required: true },
    originalName: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);
const previousFileSchema = new Schema({ file: { type: fileSchema, required: true }, replacedAt: { type: Date, required: true }, replacedBy: { type: Schema.Types.ObjectId } }, { _id: false });

const documentSchema = new Schema(
  {
    /** Human-facing id, e.g. DOC-000042. Unique, immutable, from an atomic counter. */
    documentNo: { type: String, required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    entityType: { type: String, required: true, enum: DOCUMENT_ENTITY_TYPES, immutable: true },
    entityId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    entityNo: { type: String, required: true, immutable: true },

    /** DOCUMENT_TYPE master value. */
    documentTypeId: { type: Schema.Types.ObjectId, required: true },
    /** Display title (defaults to the file name). The file's own name is kept in `file.originalName`. */
    name: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 1000 },

    file: { type: fileSchema, required: true },
    fileVersion: { type: Number, required: true, default: 1 },
    contentHash: { type: String, required: true },
    previousFiles: { type: [previousFileSchema], default: [] },

    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
documentSchema.index({ documentNo: 1 }, { unique: true });
documentSchema.index({ entityType: 1, entityId: 1, contentHash: 1 }, { unique: true, partialFilterExpression: { isArchived: false }, name: 'one_active_copy_of_a_file_per_record' });
documentSchema.index({ entityType: 1, entityId: 1, isArchived: 1, createdAt: -1 });
documentSchema.index({ branchId: 1, isArchived: 1, createdAt: -1 });
documentSchema.index({ documentTypeId: 1 });
documentSchema.index({ createdBy: 1, isArchived: 1 });
documentSchema.plugin(scopePlugin, { branchField: 'branchId' });

export type DocumentDoc = InferSchemaType<typeof documentSchema>;
export const DocumentRecord = model('Document', documentSchema);
