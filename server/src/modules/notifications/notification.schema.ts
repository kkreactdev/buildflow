import { z } from 'zod';
import { pageQuerySchema } from '../../lib/listQuery';

export const listNotificationQuery = pageQuerySchema.omit({ search: true, sort: true }).extend({
  unread: z.enum(['true', 'false']).optional(),
});
