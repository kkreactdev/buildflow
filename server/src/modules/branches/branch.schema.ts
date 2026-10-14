import { z } from 'zod';
import { pageQuerySchema } from '../../lib/listQuery';

const code = z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only');

export const createBranchBody = z.object({
  name: z.string().trim().min(2).max(120),
  code,
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(30).optional(),
});

export const updateBranchBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    code,
    address: z.string().trim().max(300).nullable(),
    phone: z.string().trim().max(30).nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listBranchQuery = pageQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
});
