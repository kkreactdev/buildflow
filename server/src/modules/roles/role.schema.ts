import { z } from 'zod';
import { isGrantable, WILDCARD } from '../../core/permissions/catalog';
import { pageQuerySchema } from '../../lib/listQuery';
import { DATA_SCOPES } from './role.model';

const permissions = z
  .array(z.string())
  .max(200)
  .superRefine((list, ctx) => {
    list.forEach((p, i) => {
      if (p === WILDCARD) ctx.addIssue({ code: 'custom', path: [i], message: 'The wildcard permission cannot be assigned to custom roles' });
      else if (!isGrantable(p)) ctx.addIssue({ code: 'custom', path: [i], message: `Unknown permission: ${p}` });
    });
  })
  .transform((list) => [...new Set(list)].sort());

export const createRoleBody = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions,
  dataScope: z.enum(DATA_SCOPES),
});

export const updateRoleBody = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).nullable(),
    permissions,
    dataScope: z.enum(DATA_SCOPES),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listRoleQuery = pageQuerySchema;
