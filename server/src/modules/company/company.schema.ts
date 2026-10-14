import { z } from 'zod';

/**
 * Optional detail fields. `null` and `''` both mean "clear it" on update — the service maps an empty
 * string to `null` so the field is unset rather than stored as a blank string.
 */
const legalName = z.string().trim().max(160).nullable().optional();
const phone = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === '' || /^[+()\d][\d\s()+-]{6,}$/.test(v), 'Enter a valid phone number')
  .nullable()
  .optional();
const email = z.string().trim().max(160).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email').nullable().optional();
const website = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === '' || /^https?:\/\/\S+\.\S+$/i.test(v), 'Enter a website starting with http:// or https://')
  .nullable()
  .optional();
/** GSTIN: 15 characters, the standard `GSTIN` shape. Optional — not every company is registered. */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .max(20)
  .refine((v) => v === '' || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(v), 'Enter a valid GSTIN (15 characters)')
  .nullable()
  .optional();

/** Editing the profile. `displayName` is required whenever it is sent; the rest are optional details. */
export const updateCompanyBody = z
  .object({
    displayName: z.string().trim().min(1, 'Enter the company name').max(120),
    legalName,
    phone,
    email,
    address: z.string().trim().max(500).nullable().optional(),
    website,
    gstin,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Which artwork slot an upload targets. */
export const logoSlotSchema = z.enum(['logo', 'logoDark', 'mark', 'markDark']);