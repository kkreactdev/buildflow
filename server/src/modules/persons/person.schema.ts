import { z } from 'zod';
import { getEnv } from '../../config/env';
import { objectIdSchema } from '../../lib/ids';
import { normalizePhone } from '../../lib/phone';

/** Accepts any common phone notation and yields the canonical E.164 string. */
export const phoneInput = z
  .string({ required_error: 'Phone is required' })
  .trim()
  .min(1, 'Phone is required')
  .transform((v, ctx) => {
    const n = normalizePhone(v, getEnv().DEFAULT_COUNTRY_CALLING_CODE);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number' });
      return z.NEVER;
    }
    return n;
  });

const name = z.string().trim().min(2).max(120);
const email = z.string().trim().toLowerCase().email().max(254);
const address = z.string().trim().max(300);

export const identityFields = z.object({
  name,
  phone: phoneInput,
  email: email.optional(),
  address: address.optional(),
});

export const lookupBody = z.object({ phone: phoneInput }).strict();

export const createPersonBody = identityFields.extend({ branchId: objectIdSchema.optional() }).strict();

export const updatePersonBody = z
  .object({ name, phone: phoneInput, email: email.nullable(), address: address.nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const linkBody = z
  .object({
    phone: phoneInput,
    /** Why this person is being brought into the branch (recorded in the audit log). */
    reason: z.string().trim().min(3, 'Give a reason').max(300),
    branchId: objectIdSchema.optional(),
  })
  .strict();
