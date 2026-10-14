import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';
import { identityFields } from '../persons/person.schema';

const notes = z.string().trim().max(2000);
const reason = z.string().trim().max(500);
/** A reason that is kept in the history of a decision, so it must say something. */
const requiredReason = (message: string) => z.string().trim().min(3, message).max(500);
const money = z.number().finite().min(0);
const date = z.coerce.date({ errorMap: () => ({ message: 'Enter a valid date' }) });

/** The proposed-property details captured before any Unit exists. Mirrors the Unit shape we will map into. */
export const propertyDetails = z.object({
  name: z.string().trim().min(1, 'Give the property a name').max(150),
  propertyTypeId: objectIdSchema.optional(),
  buildingTypeId: objectIdSchema.optional(),
  locationId: objectIdSchema.optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(12).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  plotArea: z.number().finite().min(0).optional(),
  builtUpArea: z.number().finite().min(0).optional(),
  bedrooms: z.number().finite().min(0).max(50).optional(),
  bathrooms: z.number().finite().min(0).max(50).optional(),
  description: z.string().trim().max(3000).optional(),
  askingPrice: money.optional(),
  notes: notes.optional(),
});

/**
 * Seller + first proposed property together, as agreed: a seller is never created empty, because a
 * seller record with nothing offered has nothing to act on.
 *
 * Identity is either an existing `personId` (the explicit confirmation path) or new `person` details.
 * A phone that already exists is reported, never duplicated — the persons module owns that rule.
 */
export const createSellerBody = z
  .object({
    personId: objectIdSchema.optional(),
    person: identityFields.optional(),
    branchId: objectIdSchema.optional(),
    assignedTo: objectIdSchema.optional(),
    notes: notes.optional(),
    property: propertyDetails.strict(),
  })
  .strict()
  .refine((v) => Boolean(v.personId) !== Boolean(v.person), { message: 'Provide either personId or person details', path: ['person'] });

/** A further property from an existing seller. */
export const addPropertyBody = propertyDetails.strict();

/** Descriptive fields only. Status, purchase and unit links have their own controlled operations. */
export const updateSellerBody = z.object({ notes: notes.nullable() }).partial().strict().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/**
 * Descriptive edits to a proposed property. Allowed only while no Unit exists; after that the Unit is the
 * inventory record of truth. This schema can never touch the unit link, status or purchase fields.
 */
export const updatePropertyBody = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    propertyTypeId: objectIdSchema.nullable().optional(),
    buildingTypeId: objectIdSchema.nullable().optional(),
    locationId: objectIdSchema.nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(100).nullable().optional(),
    pincode: z.string().trim().max(12).nullable().optional(),
    latitude: z.number().finite().min(-90).max(90).nullable().optional(),
    longitude: z.number().finite().min(-180).max(180).nullable().optional(),
    plotArea: z.number().finite().min(0).nullable().optional(),
    builtUpArea: z.number().finite().min(0).nullable().optional(),
    bedrooms: z.number().finite().min(0).max(50).nullable().optional(),
    bathrooms: z.number().finite().min(0).max(50).nullable().optional(),
    description: z.string().trim().max(3000).nullable().optional(),
    askingPrice: money.nullable().optional(),
    notes: notes.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const assignBody = z.object({ assignedTo: objectIdSchema, reason: reason.optional() }).strict();

/**
 * Seller relationship status move, named by the TARGET status. A reason is required so every change to
 * the relationship is explainable from its history.
 */
export const SELLER_STATUS_TARGETS = ['REGISTERED', 'VERIFIED', 'REJECTED', 'INACTIVE'] as const;
export const sellerStatusBody = z.object({ to: z.enum(SELLER_STATUS_TARGETS), reason: requiredReason('Give a reason for this change') }).strict();

export const CHECK_RESULT = ['PENDING', 'PASSED', 'FAILED'] as const;
/** The checks a proposed property needs before it can be approved. All must have PASSED. */
export const CHECKLIST_KEYS = ['titleDeed', 'encumbrance', 'taxRecords', 'siteInspection', 'measurements'] as const;

/** Verification record: the checklist outcome plus who verified it. */
export const verificationBody = z
  .object({
    outcome: z.enum(CHECK_RESULT),
    checklist: z.object(Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, z.enum(CHECK_RESULT)])) as Record<(typeof CHECKLIST_KEYS)[number], z.ZodEnum<['PENDING', 'PASSED', 'FAILED']>>).partial().strict().default({}),
    notes: notes.optional(),
    reason: reason.optional(),
  })
  .strict();

/** One negotiation round. At least one of asking / offered / counter must be present. */
export const negotiationBody = z
  .object({
    askingPrice: money.optional(),
    offeredPrice: money.optional(),
    counterPrice: money.optional(),
    outcome: z.enum(['PENDING', 'AGREED', 'DECLINED', 'WITHDRAWN']).default('PENDING'),
    /** When the discussion took place, if not just now. Never in the future. */
    discussedOn: date.optional(),
    notes: notes.optional(),
  })
  .strict()
  .refine((v) => v.askingPrice !== undefined || v.offeredPrice !== undefined || v.counterPrice !== undefined, {
    message: 'Record at least one price for this negotiation',
    path: ['askingPrice'],
  });

export const approveBody = z.object({ reason: requiredReason('Give a reason for approving') }).strict();

/**
 * Purchase completion. Records what was paid and creates exactly one Unit. `finalPrice` is required
 * because it is the acquisition price of record; the reference is required so the purchase is
 * traceable to a document.
 */
export const purchaseBody = z
  .object({
    finalPrice: money,
    purchaseDate: date,
    purchaseReference: z.string().trim().min(3, 'Record the agreement or document reference').max(300),
    reason: reason.optional(),
    /** Optional overrides for the descriptive masters copied into the new Unit. */
    propertyTypeId: objectIdSchema.optional(),
    buildingTypeId: objectIdSchema.optional(),
    locationId: objectIdSchema.optional(),
    /** Who looks after the new Unit; defaults to whoever handles the seller. */
    assignedTo: objectIdSchema.optional(),
  })
  .strict();

/**
 * Refurbishment / development tracking. `start` moves a purchased property into REFURBISHMENT; `update`
 * records progress; `complete` records that the work is finished (what Ready to Sell requires).
 */
export const refurbishBody = z
  .object({
    action: z.enum(['start', 'update', 'complete']),
    workNotes: notes.optional(),
    startedOn: date.optional(),
    completedOn: date.optional(),
    estimatedCost: money.optional(),
    actualCost: money.optional(),
    workAssignedTo: objectIdSchema.optional(),
    reason: reason.optional(),
  })
  .strict()
  .refine((v) => v.action !== 'update' || v.workNotes || v.estimatedCost !== undefined || v.actualCost !== undefined || v.workAssignedTo, {
    message: 'Record what changed: notes, a cost or the person responsible',
    path: ['workNotes'],
  });

/** Release to buyers. The listing price may be set here, since a purchase price is not a sale price. */
export const readyToSellBody = z.object({ reason: reason.optional(), expectedPrice: money.optional() }).strict();

export const rejectBody = z.object({ reason: requiredReason('Say why this property is being rejected') }).strict();
export const withdrawBody = z.object({ reason: requiredReason('Say why the seller withdrew') }).strict();

export const listSellerQuery = pageQuerySchema.merge(
  z.object({
    statusKey: z.string().trim().optional(),
    assignedTo: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
    branchId: objectIdSchema.optional(),
    search: z.string().trim().max(100).optional(),
    isArchived: z.enum(['true', 'false']).default('false'),
  }),
);

export const propertyFilters = z.object({
  sellerId: objectIdSchema.optional(),
  statusKey: z.string().trim().optional(),
  branchId: objectIdSchema.optional(),
  /** Only properties whose purchase has produced a Unit. */
  hasUnit: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  /** Registration date range (the report's date filter). */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  isArchived: z.enum(['true', 'false']).default('false'),
});
export const listPropertyQuery = pageQuerySchema.merge(propertyFilters);
