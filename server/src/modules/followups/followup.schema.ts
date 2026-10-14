import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';

const notes = z.string().trim().max(2000);
const when = z.coerce.date({ errorMap: () => ({ message: 'Enter a valid date and time' }) });

/**
 * Exactly one anchor: an enquiry, a client, or a seller. A seller anchor may be given as the seller, the
 * proposed property (its seller is implied), or both. The branch and person come from the anchor, never
 * from the request.
 */
export const createFollowUpBody = z
  .object({
    enquiryId: objectIdSchema.optional(),
    clientId: objectIdSchema.optional(),
    sellerId: objectIdSchema.optional(),
    sellerPropertyId: objectIdSchema.optional(),
    typeId: objectIdSchema,
    scheduledAt: when,
    assignedTo: objectIdSchema.optional(),
    notes: notes.optional(),
  })
  .strict()
  .refine((v) => [v.enquiryId, v.clientId, v.sellerId || v.sellerPropertyId].filter(Boolean).length === 1, { message: 'Provide exactly one of enquiryId, clientId or sellerId / sellerPropertyId', path: ['enquiryId'] });

/** Descriptive fields only. Status, time, anchor and branch change only through complete / reschedule / cancel. */
export const updateFollowUpBody = z
  .object({ typeId: objectIdSchema, assignedTo: objectIdSchema, notes: notes.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const completeBody = z.object({ outcome: z.string().trim().max(1000).optional() }).strict();
export const rescheduleBody = z.object({ scheduledAt: when, reason: z.string().trim().max(300).optional() }).strict();
export const cancelBody = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict();

const csv = z.string().transform((s) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)).pipe(z.array(z.string().max(40)).min(1).max(10));

export const followUpFilters = z.object({
  view: z.enum(['today', 'missed', 'upcoming', 'open']).optional(),
  status: csv.optional(),
  typeId: objectIdSchema.optional(),
  assignedTo: objectIdSchema.optional(),
  enquiryId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
  sellerId: objectIdSchema.optional(),
  sellerPropertyId: objectIdSchema.optional(),
  personId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  isArchived: z.enum(['true', 'false']).default('false'),
});
export type FollowUpFilters = z.infer<typeof followUpFilters>;

export const listFollowUpQuery = pageQuerySchema.merge(followUpFilters);
export const summaryQuery = z.object({ branchId: objectIdSchema.optional(), assignedTo: objectIdSchema.optional() });
