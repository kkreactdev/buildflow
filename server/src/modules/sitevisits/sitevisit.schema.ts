import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';

const when = z.coerce.date({ errorMap: () => ({ message: 'Enter a valid date and time' }) });
const text = (max: number) => z.string().trim().max(max);
const lat = z.number().finite().min(-90).max(90);
const lng = z.number().finite().min(-180).max(180);
export const MAX_UNITS = 20;
const unitIds = z.array(objectIdSchema).max(MAX_UNITS).refine((a) => new Set(a).size === a.length, 'Each unit can be listed once');

const pair = (v: { latitude?: unknown; longitude?: unknown }) => (v.latitude === undefined) === (v.longitude === undefined);
const pairMsg = { message: 'Latitude and longitude must be given together', path: ['latitude'] };

/**
 * A visit belongs to an existing enquiry; its branch, person and numbers come from that enquiry, never from the
 * request. Units are optional references (zero to MAX_UNITS), each visible to the actor and of the enquiry's branch.
 */
export const createVisitBody = z
  .object({ enquiryId: objectIdSchema, scheduledAt: when, unitIds: unitIds.default([]), assignedTo: objectIdSchema.optional(), notes: text(2000).optional(), latitude: lat.optional(), longitude: lng.optional() })
  .strict()
  .refine(pair, pairMsg);

/** Descriptive fields only. Status, assignee, enquiry and branch change only through their own operations. */
export const updateVisitBody = z
  .object({ scheduledAt: when, unitIds, notes: text(2000).nullable(), latitude: lat.nullable(), longitude: lng.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined) && (v.latitude === null) === (v.longitude === null), pairMsg);

export const assignBody = z.object({ assignedTo: objectIdSchema, reason: text(300).optional() }).strict();

export const completeBody = z
  .object({ feedback: z.string().trim().min(1, 'Record the visit feedback').max(3000), notes: text(2000).optional(), completedAt: when.optional(), latitude: lat.optional(), longitude: lng.optional() })
  .strict()
  .refine(pair, pairMsg);

export const cancelBody = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict();

const csv = z.string().transform((s) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)).pipe(z.array(z.string().max(40)).min(1).max(10));

export const visitFilters = z.object({
  view: z.enum(['today', 'upcoming', 'overdue']).optional(),
  status: csv.optional(),
  assignedTo: objectIdSchema.optional(),
  enquiryId: objectIdSchema.optional(),
  personId: objectIdSchema.optional(),
  unitId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  isArchived: z.enum(['true', 'false']).default('false'),
});
export type VisitFilters = z.infer<typeof visitFilters>;

export const listVisitQuery = pageQuerySchema.merge(visitFilters);
