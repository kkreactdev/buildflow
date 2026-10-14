import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';
import { isMasterType } from './masterTypes';

export const typeParams = z.object({
  type: z.string().refine(isMasterType, 'Unknown master type'),
});
export const typeIdParams = typeParams.extend({ id: objectIdSchema });

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');
const meta = z
  .record(z.string(), z.unknown())
  .refine((m) => JSON.stringify(m).length <= 2048, 'Metadata is limited to 2 KB');

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Letters, digits and _ only, starting with a letter (2-40 chars)');

export const createMasterBody = z
  .object({
    label: z.string().trim().min(1).max(80),
    code: code.optional(),
    description: z.string().trim().max(300).optional(),
    color: color.optional(),
    meta: meta.optional(),
    /** Required for branch-scoped types (or derived when the actor has exactly one branch). Never allowed for global types. */
    branchId: objectIdSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/** `code`, `systemKey`, `type` and `branchId` are immutable, so they are not accepted here at all. */
export const updateMasterBody = z
  .object({
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable(),
    color: color.nullable(),
    meta: meta.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const reorderBody = z
  .object({
    ids: z.array(objectIdSchema).min(1).max(500),
    /** Branch-scoped types: which branch's list is being reordered. */
    branchId: objectIdSchema.optional(),
  })
  .strict()
  .refine((v) => new Set(v.ids).size === v.ids.length, 'Duplicate ids');

export const listMasterQuery = pageQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
  branchId: objectIdSchema.optional(),
});

/** Dropdown loader: `?types=A,B&activeOnly=true&branchId=` */
export const groupedQuery = z.object({
  types: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().refine(isMasterType, 'Unknown master type')).min(1).max(30)),
  activeOnly: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  branchId: objectIdSchema.optional(),
});
