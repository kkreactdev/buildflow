import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';
import { identityFields } from '../persons/person.schema';

const notes = z.string().trim().max(2000);

/**
 * Create a client from EITHER an existing person the caller can already see
 * (`personId`, the explicit "use this person" confirmation) OR new identity
 * details (`person`). Giving both, or neither, is invalid.
 */
export const createClientBody = z
  .object({
    personId: objectIdSchema.optional(),
    person: identityFields.optional(),
    branchId: objectIdSchema.optional(),
    categoryId: objectIdSchema.optional(),
    assignedTo: objectIdSchema.optional(),
    notes: notes.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.personId) !== Boolean(v.person), { message: 'Provide either personId or person details', path: ['person'] });

/** Branch relationship data only. Identity is edited through the person endpoints; branch and client id are immutable. */
export const updateClientBody = z
  .object({ categoryId: objectIdSchema.nullable(), assignedTo: objectIdSchema.nullable(), notes: notes.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listClientQuery = pageQuerySchema.extend({
  categoryId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  assignedTo: objectIdSchema.optional(),
  isArchived: z.enum(['true', 'false']).default('false'),
});
