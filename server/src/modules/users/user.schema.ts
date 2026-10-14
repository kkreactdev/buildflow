import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';

const password = z.string().min(10, 'At least 10 characters').max(200);
const phone = z.string().trim().min(6).max(30);

export const createUserBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: phone.optional(),
  password,
  roleId: objectIdSchema,
  branchIds: z.array(objectIdSchema).max(50).default([]),
  primaryBranchId: objectIdSchema.optional(),
});

export const updateUserBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: phone.nullable(),
    password,
    roleId: objectIdSchema,
    branchIds: z.array(objectIdSchema).max(50),
    primaryBranchId: objectIdSchema.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listUserQuery = pageQuerySchema.extend({
  roleId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  isActive: z.enum(['true', 'false']).optional(),
});
