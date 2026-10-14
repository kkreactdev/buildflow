import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');

export const listStagesQuery = z.object({ includeInactive: z.enum(['true', 'false']).default('true').transform((v) => v === 'true') });

export const createStageBody = z
  .object({
    label: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).optional(),
    color: color.optional(),
    /** The new stage is inserted immediately after this stage. */
    afterSystemKey: z.string().trim().toUpperCase().min(2).max(60),
  })
  .strict();

/** systemKey, order, kind and entry rules are not accepted: they cannot be changed through the API. */
export const updateStageBody = z
  .object({
    label: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).nullable(),
    color: color.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const reorderStagesBody = z
  .object({ ids: z.array(objectIdSchema).min(2).max(100) })
  .strict()
  .refine((v) => new Set(v.ids).size === v.ids.length, 'Duplicate ids');

export const transitionsQuery = z.object({ from: z.string().trim().toUpperCase().min(2).max(60) });
