import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';

export const listAuditQuery = pageQuerySchema.omit({ search: true, sort: true }).extend({
  entityType: z.string().trim().max(40).optional(),
  entityId: objectIdSchema.optional(),
  userId: objectIdSchema.optional(),
  action: z.string().trim().max(40).optional(),
  branchId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
