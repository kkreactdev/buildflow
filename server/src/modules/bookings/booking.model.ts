import { Schema, model, type InferSchemaType } from 'mongoose';
import { immutablePlugin } from '../../core/audit/immutable';
import { branchOwnedFields, scopePlugin } from '../../core/scope/scopePlugin';

/**
 * A booking: one salesperson reserving ONE unit for ONE enquiry's person. It is its own record, not just a unit
 * status, and it is never deleted: releasing keeps it as history.
 *
 * THE RULE: a unit has at most one ACTIVE booking. That is enforced by the database through a partial unique
 * index on `unitId` where `status` is ACTIVE, so no amount of application races (or bypassing the service) can
 * create two. Released bookings are outside the index and never block a later booking.
 */
const bookingSchema = new Schema(
  {
    /** Human-facing id, e.g. BK-000042. Unique, immutable, from an atomic counter. */
    bookingNo: { type: String, required: true, immutable: true },
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', required: true, immutable: true },
    unitCode: { type: String, required: true, immutable: true },
    enquiryId: { type: Schema.Types.ObjectId, ref: 'Enquiry', required: true, immutable: true },
    enquiryNo: { type: String, required: true, immutable: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true, immutable: true },
    personName: { type: String, required: true },
    phoneE164: { type: String, required: true },
    /** Set when the person is already a client of this branch at booking time (no conversion happens here). */
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', immutable: true },
    clientNo: { type: String, immutable: true },

    /** The salesperson the booking belongs to (the OWN-scope owner). */
    salespersonId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Who recorded it (differs from the salesperson when a manager books on someone's behalf). */
    bookedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    /** When the booking was made, as an instant (UTC); shown in the application time zone. */
    bookingDate: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 2000 },

    status: { type: String, required: true, enum: ['ACTIVE', 'RELEASED'] },
    releasedAt: { type: Date },
    releasedBy: { type: Schema.Types.ObjectId },
    releaseReason: { type: String, trim: true, maxlength: 500 },

    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
bookingSchema.index({ bookingNo: 1 }, { unique: true });
bookingSchema.index({ unitId: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: 'one_active_booking_per_unit' });
bookingSchema.index({ branchId: 1, status: 1, bookingDate: -1 });
bookingSchema.index({ unitId: 1, createdAt: -1 });
bookingSchema.index({ enquiryId: 1, createdAt: -1 });
bookingSchema.index({ salespersonId: 1, status: 1 });
bookingSchema.index({ personId: 1 });
bookingSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'salespersonId' });

export type BookingDoc = InferSchemaType<typeof bookingSchema>;
export const Booking = model('Booking', bookingSchema);

/** Append-only history of what happened to a booking (who, when, why). Never edited. */
const eventSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, required: true },
    bookingNo: { type: String, required: true },
    branchId: { ...branchOwnedFields.branchId },
    unitId: { type: Schema.Types.ObjectId, required: true },
    enquiryId: { type: Schema.Types.ObjectId, required: true },
    salespersonId: { type: Schema.Types.ObjectId },
    type: { type: String, required: true, enum: ['CREATED', 'UPDATED', 'RELEASED'] },
    byUserId: { type: Schema.Types.ObjectId },
    reason: { type: String, trim: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);
eventSchema.index({ bookingId: 1, at: 1 });
eventSchema.index({ unitId: 1, at: -1 });
eventSchema.plugin(scopePlugin, { branchField: 'branchId' });
eventSchema.plugin(immutablePlugin);
export const BookingEvent = model('BookingEvent', eventSchema);

/**
 * A booking attempt that lost: the unit was already booked. It records who tried, for which enquiry, and what held
 * the unit, so a manager can keep the existing booking or replace it. The loser's own request created nothing else.
 */
const conflictSchema = new Schema(
  {
    branchId: { ...branchOwnedFields.branchId, immutable: true },
    unitId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    unitCode: { type: String, required: true, immutable: true },
    /** The booking that held the unit when the attempt lost (if it could be found). */
    existingBookingId: { type: Schema.Types.ObjectId },
    existingBookingNo: { type: String },
    attemptedBy: { type: Schema.Types.ObjectId, required: true, immutable: true },
    attemptedEnquiryId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    attemptedEnquiryNo: { type: String, required: true, immutable: true },
    attemptedPersonName: { type: String, required: true },
    attemptedSalespersonId: { type: Schema.Types.ObjectId, required: true },
    attemptedBookingDate: { type: Date, required: true },
    attemptedNotes: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, required: true, enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
    resolution: { type: String, enum: ['KEEP_EXISTING', 'REPLACE'] },
    resolvedBy: { type: Schema.Types.ObjectId },
    resolvedAt: { type: Date },
    resolutionNote: { type: String, trim: true, maxlength: 500 },
    resolvedBookingId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
conflictSchema.index({ branchId: 1, status: 1, createdAt: -1 });
conflictSchema.index({ unitId: 1, createdAt: -1 });
conflictSchema.plugin(scopePlugin, { branchField: 'branchId', ownerField: 'attemptedBy' });

export type BookingConflictDoc = InferSchemaType<typeof conflictSchema>;
export const BookingConflict = model('BookingConflict', conflictSchema);
