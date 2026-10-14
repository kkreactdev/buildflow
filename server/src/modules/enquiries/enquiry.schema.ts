import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';
import { identityFields } from '../persons/person.schema';

const nullableId = objectIdSchema.nullable();
const notes = z.string().trim().max(2000);
const stageKey = z.string().trim().toUpperCase().min(2).max(60);

/** Existing visible person (`personId`, the explicit confirmation) OR new identity details (`person`), exactly one.
 *  Master references are ids of ACTIVE values; `locationId` must belong to the enquiry's branch (checked in the service). */
export const createEnquiryBody = z
  .object({
    personId: objectIdSchema.optional(),
    person: identityFields.optional(),
    branchId: objectIdSchema.optional(),
    /** REQUIRED: every enquiry needs a source (an ACTIVE ENQUIRY_SOURCE master value). The other masters stay optional. */
    sourceId: objectIdSchema,
    typeId: objectIdSchema.optional(),
    propertyTypeId: objectIdSchema.optional(),
    buildingTypeId: objectIdSchema.optional(),
    locationId: objectIdSchema.optional(),
    assignedTo: objectIdSchema.optional(),
    notes: notes.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.personId) !== Boolean(v.person), { message: 'Provide either personId or person details', path: ['person'] });

/**
 * Descriptive fields only. Stage, owner, branch, person, lost reason and numbers are NOT accepted here
 * (each has its own controlled operation), so a generic update can never bypass the workflow.
 */
export const updateEnquiryBody = z
  // sourceId can be changed but never cleared: an enquiry must always keep a source.
  .object({ sourceId: objectIdSchema, typeId: nullableId, propertyTypeId: nullableId, buildingTypeId: nullableId, locationId: nullableId, notes: notes.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Conversion to a client. Both fields are optional; the client's branch, person and number come from the enquiry, never the request. */
export const convertBody = z.object({ categoryId: objectIdSchema.optional(), notes: notes.optional() }).strict();

export const assignBody = z.object({ assignedTo: objectIdSchema, reason: z.string().trim().max(300).optional() }).strict();

/** `from` is the stage the screen believes the enquiry is in; a mismatch means someone else moved it (409). */
export const transitionBody = z
  .object({ to: stageKey, from: stageKey.optional(), reason: z.string().trim().max(500).optional(), lostReasonId: objectIdSchema.optional() })
  .strict();
export const loseBody = z.object({ lostReasonId: objectIdSchema, note: z.string().trim().max(500).optional(), from: stageKey.optional() }).strict();
export const reopenBody = z.object({ to: stageKey, reason: z.string().trim().max(500), from: stageKey.optional() }).strict();

const csv = (item: z.ZodString) => z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(item).min(1).max(30));

/** Filters shared by the list, the board and the export. */
export const enquiryFilters = z.object({
  search: z.string().trim().max(100).optional(),
  stage: csv(stageKey).optional(),
  sourceId: objectIdSchema.optional(),
  typeId: objectIdSchema.optional(),
  propertyTypeId: objectIdSchema.optional(),
  buildingTypeId: objectIdSchema.optional(),
  locationId: objectIdSchema.optional(),
  assignedTo: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
  personId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  isArchived: z.enum(['true', 'false']).default('false'),
});
export type EnquiryFilters = z.infer<typeof enquiryFilters>;

export const listEnquiryQuery = pageQuerySchema.omit({ search: true }).merge(enquiryFilters);
export const boardQuery = enquiryFilters.extend({ perStage: z.coerce.number().int().min(1).max(50).default(20) });
export const exportQuery = enquiryFilters;
