import { z } from 'zod';
import { ACTIVITY_REF_TYPES } from '../../core/activity/activity.model';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';

export const listActivityQuery = pageQuerySchema
  .omit({ search: true, sort: true })
  .extend({
    refType: z.enum(ACTIVITY_REF_TYPES).optional(),
    refId: objectIdSchema.optional(),
    type: z.string().trim().toUpperCase().max(60).optional(),
    userId: objectIdSchema.optional(),
    branchId: objectIdSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((q) => Boolean(q.refType) === Boolean(q.refId), { message: 'refType and refId must be given together', path: ['refId'] });
