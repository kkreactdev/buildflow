import { Schema, model, type InferSchemaType } from 'mongoose';
import { immutablePlugin } from '../../core/audit/immutable';
import { branchOwnedFields, scopePlugin, softDeleteFields } from '../../core/scope/scopePlugin';

/**
 * A unit / property: a TOP-LEVEL entity of one branch. There is no mandatory project or site above it.
 *
 * - Descriptive masters (property type, building type, location) are referenced by id; display resolves
 *   them including inactive values so history keeps its meaning.
 * - `statusId` points at a UNIT_STATUS master; `statusKey` is its immutable system key (AVAILABLE, BOOKED,
 *   SOLD, ...) kept alongside so queries and compare-and-set updates never depend on labels or ids. Both
 *   change ONLY through the controlled status operation (and, in Phase 9, booking), never a generic edit.
 * - Booking (Phase 9) will live in its own collection (one ACTIVE booking per unit, enforced by a partial
 *   unique index there) and flip `statusKey` with a conditional update; nothing booking-specific is stored here.
 */
const mediaSchema = new Schema(
  {
    /** MEDIA_TYPE master (front, floor plan, brochure, ...). */
    typeId: { type: Schema.Types.ObjectId, required: true },
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    format: { type: String, required: true, enum: ['jpg', 'png', 'webp', 'pdf'] },
    bytes: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    caption: { type: String, trim: true, maxlength: 200 },
    uploadedBy: { type: Schema.Types.ObjectId },
    uploadedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
);

const unitSchema = new Schema(
  {
    /** Human-facing id, e.g. UNT-000042. Unique, immutable, never reused, from an atomic counter. */
    unitCode: { type: String, required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },

    propertyTypeId: { type: Schema.Types.ObjectId },
    buildingTypeId: { type: Schema.Types.ObjectId },
    /** LOCATION master value of THIS unit's branch. */
    locationId: { type: Schema.Types.ObjectId },

    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    pincode: { type: String, trim: true, maxlength: 12 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },

    /** Square feet. */
    plotArea: { type: Number, min: 0 },
    builtUpArea: { type: Number, min: 0 },
    /** Whole currency units (INR). */
    expectedPrice: { type: Number, min: 0 },
    bedrooms: { type: Number, min: 0, max: 50 },
    bathrooms: { type: Number, min: 0, max: 50 },
    description: { type: String, trim: true, maxlength: 3000 },

    statusId: { type: Schema.Types.ObjectId, required: true },
    statusKey: { type: String, required: true },
    statusChangedAt: { type: Date, required: true },
    /**
     * Optional expiry for a non-standard (hold-like) status. The unit is treated as held while
     * `now <= heldUntil` and as effectively AVAILABLE once `now > heldUntil`, regardless of whether
     * a background job has flipped the status field. `null` means the hold has no expiry set, so
     * the unit stays held until someone changes the status. AVAILABLE/BOOKED/SOLD ignore this field.
     */
    heldUntil: { type: Date, default: null },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },

    media: { type: [mediaSchema], default: [] },

    ...softDeleteFields,
    createdBy: { type: Schema.Types.ObjectId },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
unitSchema.index({ unitCode: 1 }, { unique: true });
unitSchema.index({ branchId: 1, isArchived: 1, statusKey: 1, createdAt: -1 });
unitSchema.index({ branchId: 1, isArchived: 1, createdAt: -1 });
unitSchema.index({ branchId: 1, isArchived: 1, expectedPrice: 1 });
unitSchema.index({ assignedTo: 1, isArchived: 1, statusKey: 1 });
unitSchema.index({ branchId: 1, name: 1 });
for (const f of ['propertyTypeId', 'buildingTypeId', 'locationId', 'statusId', 'media.typeId']) unitSchema.index({ [f]: 1 }); // master reference checks + filters
unitSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'assignedTo' });

export type UnitDoc = InferSchemaType<typeof unitSchema>;
export const Unit = model('Unit', unitSchema);

/** Who was responsible for the unit when; never overwritten. */
const assignmentSchema = new Schema(
  {
    unitId: { type: Schema.Types.ObjectId, required: true },
    branchId: { ...branchOwnedFields.branchId },
    fromUserId: { type: Schema.Types.ObjectId },
    toUserId: { type: Schema.Types.ObjectId, required: true },
    byUserId: { type: Schema.Types.ObjectId },
    reason: { type: String, trim: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
assignmentSchema.index({ unitId: 1, at: 1 });
assignmentSchema.plugin(scopePlugin, { branchField: 'branchId' });
assignmentSchema.plugin(immutablePlugin);
export const UnitAssignment = model('UnitAssignment', assignmentSchema);
