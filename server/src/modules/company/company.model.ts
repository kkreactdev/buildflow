import { Schema, model, type InferSchemaType } from 'mongoose';

/** The single profile's discriminator. Used as the upsert filter, so there can only ever be one. */
export const SINGLETON_KEY = 'company';

/**
 * The company profile: ONE document for the whole company (BuildFlow is a CRM for a single company
 * with many branches, so there is no tenant and nothing to scope by branch).
 *
 * Deliberately follows the `WorkflowStage` / `WhatsAppTemplate` pattern: a branch-less, unscoped
 * model whose WRITES are gated in the service by `company.manage` AND `dataScope === 'ALL'`.
 * It stores no branch relationship, so the scope plugin does not apply — and the conventions test
 * only demands a scope for models that carry a `branchId`, which this one never will.
 *
 * Logos are PUBLIC assets (stored as `publicId` + `url`, like unit media) rather than documents.
 * The login page renders branding before anyone has signed in, so a private signed URL — which
 * expires — cannot be used here. Nothing secret belongs in this document.
 */
const logoSchema = new Schema(
  {
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    format: { type: String, required: true, enum: ['jpg', 'png', 'webp'] },
    bytes: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    uploadedBy: { type: Schema.Types.ObjectId },
    uploadedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const companySchema = new Schema(
  {
    /** Fixed discriminator so there is exactly one profile — the `Counter` pattern, not a magic _id. */
    key: { type: String, required: true, immutable: true, default: SINGLETON_KEY },
    /** The name shown in the app, on the login page and in branding. The only required field. */
    displayName: { type: String, required: true, trim: true, maxlength: 120 },
    /** Registered / legal entity name, if it differs from the display name. */
    legalName: { type: String, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 40 },
    email: { type: String, trim: true, maxlength: 160 },
    address: { type: String, trim: true, maxlength: 500 },
    website: { type: String, trim: true, maxlength: 200 },
    /** Indian GSTIN, when the company is registered. */
    gstin: { type: String, trim: true, uppercase: true, maxlength: 20 },

    /** Full lockup (icon + wordmark) for light backgrounds. */
    logo: { type: logoSchema },
    /** Full lockup for dark backgrounds. Optional: falls back to the light one. */
    logoDark: { type: logoSchema },
    /** Icon/mark alone, shown when the sidebar is collapsed. */
    mark: { type: logoSchema },
    markDark: { type: logoSchema },

    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

/** Exactly one company profile exists; the unique key makes the singleton real rather than assumed. */
companySchema.index({ key: 1 }, { unique: true });

export type CompanyProfileDoc = InferSchemaType<typeof companySchema>;
export const CompanyProfile = model('CompanyProfile', companySchema);