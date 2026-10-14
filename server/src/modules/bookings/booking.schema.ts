import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';

/**
 * A date-time that states its time zone ("Z" or an offset). A bare "2026-10-08T10:00" would silently mean the
 * server's zone, so it is refused: the booking date is always an unambiguous instant.
 */
const instant = z
  .string({ required_error: 'Booking date is required' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/, 'Enter a date and time with its time zone (for example 2026-10-08T10:30:00+05:30)')
  .transform((s) => new Date(s))
  .refine((d) => !Number.isNaN(d.getTime()), 'Enter a valid date and time');

const notes = z.string().trim().max(2000);

export const createBookingBody = z
  .object({ unitId: objectIdSchema, enquiryId: objectIdSchema, bookingDate: instant, salespersonId: objectIdSchema.optional(), notes: notes.optional() })
  .strict();

/** Only descriptive fields of an ACTIVE booking. Unit, enquiry, salesperson and status have their own operations. */
export const updateBookingBody = z
  .object({ bookingDate: instant, notes: notes.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const releaseBody = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) }).strict();

const csv = z.string().transform((s) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)).pipe(z.array(z.enum(['ACTIVE', 'RELEASED'])).min(1).max(2));

export const bookingFilters = z.object({
  status: csv.optional(),
  unitId: objectIdSchema.optional(),
  enquiryId: objectIdSchema.optional(),
  personId: objectIdSchema.optional(),
  salespersonId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type BookingFilters = z.infer<typeof bookingFilters>;
export const listBookingQuery = pageQuerySchema.merge(bookingFilters);

export const listConflictQuery = pageQuerySchema.omit({ search: true }).extend({
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
  unitId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
});

/** KEEP_EXISTING leaves the current booking alone; REPLACE releases it (reason) and books the unit for the challenger. */
export const resolveConflictBody = z
  .object({ resolution: z.enum(['KEEP_EXISTING', 'REPLACE']), reason: z.string().trim().max(500).optional() })
  .strict()
  .refine((v) => v.resolution === 'KEEP_EXISTING' || (v.reason && v.reason.length >= 3), { message: 'Give a reason for replacing the booking', path: ['reason'] });
