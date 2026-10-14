import { z } from 'zod';
import { MAX_TEMPLATE_BODY } from '../../lib/templateVariables';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';

const name = z.string().trim().min(2, 'Give the template a name').max(120);
const body = z.string().trim().min(1, 'Write the message').max(MAX_TEMPLATE_BODY, `At most ${MAX_TEMPLATE_BODY} characters`);

/** The variables are NOT accepted: they are derived from the body by the server, so they can never disagree with it. */
export const createTemplateBody = z.object({ name, categoryId: objectIdSchema, eventId: objectIdSchema, body, isActive: z.boolean().default(true) }).strict();

export const updateTemplateBody = z
  .object({ name, categoryId: objectIdSchema, eventId: objectIdSchema, body, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listTemplateQuery = pageQuerySchema.extend({
  categoryId: objectIdSchema.optional(),
  eventId: objectIdSchema.optional(),
  isActive: z.enum(['true', 'false']).optional(),
  isArchived: z.enum(['true', 'false']).default('false'),
});
