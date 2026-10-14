import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';
import { identityFields } from '../persons/person.schema';

const notes = z.string().trim().max(2000);
const reason = z.string().trim().max(300);

/**
 * An EXTERNAL referral: an existing visible person (`personId`, the explicit confirmation) OR new identity details
 * (`person`), exactly one. A phone that already exists is reported (PERSON_EXISTS), never duplicated or merged.
 * The type is not accepted: the flow decides it.
 */
export const createReferralBody = z
  .object({ personId: objectIdSchema.optional(), person: identityFields.optional(), branchId: objectIdSchema.optional(), assignedTo: objectIdSchema.optional(), notes: notes.optional(), reason: reason.optional() })
  .strict()
  .refine((v) => Boolean(v.personId) !== Boolean(v.person), { message: 'Provide either personId or person details', path: ['person'] });

/** From an existing client: nothing about the person is typed again. The branch is the client's. */
export const fromClientBody = z.object({ assignedTo: objectIdSchema.optional(), notes: notes.optional(), reason: reason.optional() }).strict();

/** From an existing employee: the branch must be one the employee belongs to. */
export const fromUserBody = z.object({ branchId: objectIdSchema.optional(), assignedTo: objectIdSchema.optional(), notes: notes.optional(), reason: reason.optional() }).strict();

/** Descriptive fields only. Identity belongs to the person; type, source, branch and enquiries have their own operations. */
export const updateReferralBody = z.object({ notes: notes.nullable() }).partial().strict().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const assignBody = z.object({ assignedTo: objectIdSchema, reason: reason.optional() }).strict();
export const linkEnquiryBody = z.object({ enquiryId: objectIdSchema }).strict();
export const unlinkEnquiryBody = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict();
export const unlinkParams = z.object({ id: objectIdSchema, enquiryId: objectIdSchema });
export const fromClientParams = z.object({ clientId: objectIdSchema });
export const fromUserParams = z.object({ userId: objectIdSchema });

export const referralFilters = z.object({
  typeId: objectIdSchema.optional(),
  assignedTo: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
  enquiryId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  isArchived: z.enum(['true', 'false']).default('false'),
});
export type ReferralFilters = z.infer<typeof referralFilters>;
export const listReferralQuery = pageQuerySchema.merge(referralFilters);
