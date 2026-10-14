import type { Types } from 'mongoose';
import type { z } from 'zod';
import { recordAudit } from '../../core/audit/audit.service';
import { assertPermission, type Principal } from '../../core/permissions/principal';
import { destroyQuietly, getMediaProvider } from '../../core/storage/mediaProvider';
import { detectFormat } from '../../core/storage/fileTypes';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { CompanyProfile, SINGLETON_KEY } from './company.model';
import type { logoSlotSchema, updateCompanyBody } from './company.schema';

type LogoSlot = z.infer<typeof logoSlotSchema>;

interface LogoLean {
  publicId: string; url: string; format: string; bytes: number; width?: number; height?: number; uploadedAt: Date;
}
type Lean = {
  _id: Types.ObjectId;
  displayName: string;
  legalName?: string | null; phone?: string | null; email?: string | null; address?: string | null; website?: string | null; gstin?: string | null;
  logo?: LogoLean; logoDark?: LogoLean; mark?: LogoLean; markDark?: LogoLean;
  updatedAt?: Date;
};

const EMPTY_LEAN = {
  _id: undefined as unknown as Types.ObjectId,
  displayName: '',
} as Lean;

const logoView = (l?: LogoLean) => (l ? { url: l.url, width: l.width ?? null, height: l.height ?? null, bytes: l.bytes, format: l.format, uploadedAt: l.uploadedAt } : null);

const toView = (c: Lean) => ({
  displayName: c.displayName,
  legalName: c.legalName ?? undefined,
  phone: c.phone ?? undefined,
  email: c.email ?? undefined,
  address: c.address ?? undefined,
  website: c.website ?? undefined,
  gstin: c.gstin ?? undefined,
  logo: logoView(c.logo),
  logoDark: logoView(c.logoDark),
  mark: logoView(c.mark),
  markDark: logoView(c.markDark),
  updatedAt: c.updatedAt,
});

/** Company-wide configuration: `company.manage` AND access to every branch, exactly like the workflow. */
export function assertCanManageCompany(principal: Principal | undefined): asserts principal is Principal {
  assertPermission(principal, 'company.manage');
  if (principal.dataScope !== 'ALL') throw AppError.forbidden('The company profile is company-wide and can only be changed by users with access to all branches');
}

/** Read the singleton. Never creates one — a missing profile is a valid, empty state. */
async function findProfile(): Promise<Lean | null> {
  return CompanyProfile.findOne({ key: SINGLETON_KEY }).lean<Lean>();
}

/**
 * Branding for EVERYONE, including the login page where nobody is signed in yet.
 *
 * This is deliberately the smallest possible projection: the name and four image URLs, and nothing
 * else. Legal name, GSTIN, address, phone and email stay behind `company.view` — a pre-authentication
 * response must never carry company registration details.
 *
 * Each variant falls back to its light counterpart, so a company that uploads only a light logo still
 * renders correctly on a dark background (CSS picks the dark twin whenever one exists).
 */
export async function getBranding() {
  const c = await findProfile();
  if (!c) return { displayName: '', logo: null, logoDark: null, mark: null, markDark: null };
  return {
    displayName: c.displayName,
    logo: c.logo?.url ?? null,
    logoDark: c.logoDark?.url ?? c.logo?.url ?? null,
    mark: c.mark?.url ?? null,
    markDark: c.markDark?.url ?? c.mark?.url ?? null,
  };
}

/** The full profile, for the settings screen. Requires `company.view`. */
export async function getProfile(principal: Principal) {
  assertPermission(principal, 'company.view');
  return toView((await findProfile()) ?? EMPTY_LEAN);
}

const OPTIONAL_DETAILS = ['legalName', 'phone', 'email', 'address', 'website', 'gstin'] as const;
const auditView = (c: Lean) => ({ displayName: c.displayName, ...Object.fromEntries(OPTIONAL_DETAILS.map((f) => [f, c[f] ?? null])) });

/** Edit the company name and the optional legal details. Logos are replaced through the upload endpoints. */
export async function updateProfile(principal: Principal, input: z.infer<typeof updateCompanyBody>) {
  assertCanManageCompany(principal);
  const before = await findProfile();

  const set: Record<string, unknown> = { displayName: input.displayName, updatedBy: toObjectId(principal.userId) };
  // An empty string clears a field; `undefined` (not sent) leaves it alone.
  for (const f of OPTIONAL_DETAILS) {
    if (input[f] !== undefined) set[f] = input[f] === '' ? null : input[f];
  }

  const updated = await CompanyProfile.findOneAndUpdate({ key: SINGLETON_KEY }, { $set: set, $setOnInsert: { key: SINGLETON_KEY } }, { new: true, upsert: true }).lean<Lean>();
  if (!updated) throw AppError.notFound('Company profile not found');
  await recordAudit({ entityType: 'company', entityId: updated._id, action: 'update', before: before ? auditView(before) : undefined, after: auditView(updated), userId: principal.userId });
  return toView(updated);
}

/**
 * Upload one branding image into a slot, replacing whatever was there.
 *
 * Uses the shared media provider and the shared magic-byte sniffing, so the file's REAL type decides,
 * never the browser's claim. Logos are PUBLIC assets (the login page renders them before sign-in, so
 * an expiring signed URL would not work) and no image bytes are stored in the document — only the
 * provider reference and URL.
 */
export async function uploadLogo(principal: Principal, slot: LogoSlot, file: Express.Multer.File | undefined) {
  assertCanManageCompany(principal);
  if (!file || file.buffer.length === 0) throw AppError.validation('Choose an image to upload', [{ path: 'file', message: 'Required' }]);

  const format = detectFormat(file.buffer);
  // Logos must be able to sit on any background, so a PDF or anything else is refused here even
  // though the unit-media uploader would accept it.
  if (!format || format === 'pdf') throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'A logo must be a JPEG, PNG or WebP image');

  const before = await findProfile();
  const asset = await getMediaProvider().upload(file.buffer, { folder: `company/branding/${slot}`, format });
  const logo = { publicId: asset.publicId, url: asset.url, format, bytes: asset.bytes, width: asset.width, height: asset.height, uploadedBy: toObjectId(principal.userId), uploadedAt: new Date() };

  try {
    const updated = await CompanyProfile.findOneAndUpdate({ key: SINGLETON_KEY }, { $set: { [slot]: logo, updatedBy: toObjectId(principal.userId) }, $setOnInsert: { key: SINGLETON_KEY, displayName: '' } }, { new: true, upsert: true }).lean<Lean>();
    if (!updated) throw AppError.notFound('Company profile not found');
    await recordAudit({ entityType: 'company', entityId: updated._id, action: 'logo_upload', before: { slot, had: Boolean(before?.[slot]) }, after: { slot, format, bytes: asset.bytes }, userId: principal.userId });
    return toView(updated);
  } catch (err) {
    // Nothing references the new file: do not leave it behind in the provider.
    await destroyQuietly(asset.publicId, (o, m) => logger.error(o, m));
    throw err;
  }
}

/** Clear one branding slot and delete the stored asset. */
export async function removeLogo(principal: Principal, slot: LogoSlot) {
  assertCanManageCompany(principal);
  const before = await findProfile();
  const removed = before?.[slot];
  const updated = await CompanyProfile.findOneAndUpdate({ key: SINGLETON_KEY }, { $unset: { [slot]: 1 }, $set: { updatedBy: toObjectId(principal.userId) } }, { new: true }).lean<Lean>();
  if (!updated) throw AppError.notFound('Company profile not found');
  await recordAudit({ entityType: 'company', entityId: updated._id, action: 'logo_remove', before: { slot, had: Boolean(removed) }, after: { slot, had: false }, userId: principal.userId });
  // After commit: a failed delete only leaves an orphaned file, never a dangling reference.
  if (removed) await destroyQuietly(removed.publicId, (o, m) => logger.error(o, m));
  return toView(updated);
}