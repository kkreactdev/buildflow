import { Types, type ClientSession } from 'mongoose';
import type { z } from 'zod';
import { getEnv } from '../../config/env';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { formatSequence, nextSequence } from '../../core/counters/counter.service';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { resolveWriteBranch, scopedRepo } from '../../core/scope';
import { detectFormat } from '../../core/storage/fileTypes';
import { destroyQuietly, getMediaProvider } from '../../core/storage/mediaProvider';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { logger } from '../../lib/logger';
import { withTransaction } from '../../lib/transaction';
import { Branch } from '../branches/branch.model';
import { unitBookingPanel } from '../bookings/booking.service';
import { listForUnit } from '../unitInterests/unitInterest.service';
import { unitAcquisition } from '../sellers/seller.eligibility';
import { assertActiveMaster, masterLabels } from '../masters/master.service';
import { validateAssignee } from '../users/assignable';
import { User } from '../users/user.model';
import { Unit, UnitAssignment } from './unit.model';
import { getUnitStatusByKey, statusKeyOf } from './unit.masters';
import './unit.references';
import type { assignBody, createUnitBody, listUnitQuery, statusBody, UnitFilters, updateUnitBody } from './unit.schema';
import { BOOKING_OWNED, INITIAL_STATUS, SELLER_OWNED, UNIT_STATUS_KEYS } from './unit.status';

const UNIT_CODE = { prefix: 'UNT-', width: 6 } as const;
export const nextUnitCode = async (): Promise<string> => formatSequence(await nextSequence('unit'), UNIT_CODE);

type Id = Types.ObjectId;
interface MediaLean { _id: Id; typeId: Id; publicId: string; url: string; format: string; bytes: number; width?: number; height?: number; caption?: string; uploadedBy?: Id; uploadedAt: Date }
export type UnitLean = {
  _id: Id; unitCode: string; branchId: Id; name: string;
  propertyTypeId?: Id | null; buildingTypeId?: Id | null; locationId?: Id | null;
  address?: string | null; city?: string | null; state?: string | null; pincode?: string | null; latitude?: number | null; longitude?: number | null;
  plotArea?: number | null; builtUpArea?: number | null; expectedPrice?: number | null; bedrooms?: number | null; bathrooms?: number | null; description?: string | null;
  statusId: Id; statusKey: string; statusChangedAt: Date; assignedTo?: Id | null; assignedAt?: Date | null;
  media?: MediaLean[]; isArchived?: boolean; createdAt?: Date; updatedAt?: Date;
};

/** Master fields a unit stores, and the master type each must belong to. */
const MASTER_FIELDS = [
  ['propertyTypeId', 'PROPERTY_TYPE'],
  ['buildingTypeId', 'BUILDING_TYPE'],
  ['locationId', 'LOCATION'],
] as const;
const PLAIN_FIELDS = ['address', 'city', 'state', 'pincode', 'latitude', 'longitude', 'plotArea', 'builtUpArea', 'expectedPrice', 'bedrooms', 'bathrooms', 'description'] as const;

const repo = (principal: Principal, requestedBranchId?: string, includeArchived = false) => scopedRepo(Unit, principal, { requestedBranchId, includeArchived });

// ---- validation -------------------------------------------------------------

/** New or changed master references must exist, be ACTIVE, be visible to the actor; a LOCATION must belong to the unit's own branch. */
async function validateMasters(principal: Principal, branchId: string, ids: Partial<Record<(typeof MASTER_FIELDS)[number][0], string | null | undefined>>) {
  for (const [field, type] of MASTER_FIELDS) {
    const id = ids[field];
    if (!id) continue;
    const m = await assertActiveMaster(principal, type, id, field);
    if (type === 'LOCATION' && m.branchId?.toHexString() !== branchId) {
      throw AppError.validation('Invalid location', [{ path: field, message: "Choose a location of this unit's branch" }]);
    }
  }
}

// ---- views --------------------------------------------------------------------

async function lookups(principal: Principal, rows: UnitLean[]) {
  const masterIds = new Set<string>();
  const userIds = new Set<string>();
  const branchIds = new Set<string>();
  for (const r of rows) {
    for (const f of ['propertyTypeId', 'buildingTypeId', 'locationId', 'statusId'] as const) if (r[f]) masterIds.add(r[f]!.toHexString());
    for (const m of r.media ?? []) masterIds.add(m.typeId.toHexString());
    if (r.assignedTo) userIds.add(r.assignedTo.toHexString());
    branchIds.add(r.branchId.toHexString());
  }
  const [masters, users, branches] = await Promise.all([
    masterIds.size ? masterLabels(principal, [...masterIds]) : new Map(),
    userIds.size ? scopedRepo(User, principal).find({ _id: { $in: [...userIds].map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [],
    scopedRepo(Branch, principal).find({ _id: { $in: [...branchIds].map((i) => toObjectId(i)) } }).select('name code').lean<{ _id: Id; name: string; code: string }[]>(),
  ]);
  return {
    masters,
    users: new Map(users.map((u) => [u._id.toHexString(), u.name])),
    branches: new Map(branches.map((b) => [b._id.toHexString(), { name: b.name, code: b.code }])),
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

export const isImage = (format: string) => format !== 'pdf';

function mediaView(m: MediaLean, l: Lookups) {
  return { id: m._id.toHexString(), typeId: m.typeId.toHexString(), type: l.masters.get(m.typeId.toHexString()), url: m.url, format: m.format, isImage: isImage(m.format), bytes: m.bytes, width: m.width, height: m.height, caption: m.caption ?? undefined, uploadedAt: m.uploadedAt };
}

export function toView(u: UnitLean, l: Lookups, principal: Principal, detail = false) {
  const m = (id?: Id | null) => (id ? l.masters.get(id.toHexString()) : undefined); // includes inactive values: history keeps its meaning
  const live = !u.isArchived;
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(principal, k);
  const media = u.media ?? [];
  const cover = media.find((x) => isImage(x.format));
  return {
    id: u._id.toHexString(),
    unitCode: u.unitCode,
    name: u.name,
    branchId: u.branchId.toHexString(),
    branch: l.branches.get(u.branchId.toHexString()),
    propertyType: m(u.propertyTypeId), buildingType: m(u.buildingTypeId), location: m(u.locationId),
    propertyTypeId: u.propertyTypeId?.toHexString(), buildingTypeId: u.buildingTypeId?.toHexString(), locationId: u.locationId?.toHexString(),
    address: u.address ?? undefined, city: u.city ?? undefined, state: u.state ?? undefined, pincode: u.pincode ?? undefined,
    latitude: u.latitude ?? undefined, longitude: u.longitude ?? undefined,
    plotArea: u.plotArea ?? undefined, builtUpArea: u.builtUpArea ?? undefined, expectedPrice: u.expectedPrice ?? undefined,
    bedrooms: u.bedrooms ?? undefined, bathrooms: u.bathrooms ?? undefined, description: u.description ?? undefined,
    statusId: u.statusId.toHexString(), statusKey: u.statusKey, status: m(u.statusId), statusChangedAt: u.statusChangedAt,
    assignedTo: u.assignedTo?.toHexString(), assignedToName: u.assignedTo ? l.users.get(u.assignedTo.toHexString()) : undefined, assignedAt: u.assignedAt ?? undefined,
    mediaCount: media.length,
    coverUrl: cover?.url,
    ...(detail ? { media: media.map((x) => mediaView(x, l)) } : {}),
    isArchived: Boolean(u.isArchived),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    /** What this user may do with this unit right now; the UI shows exactly these controls. */
    allowed: {
      edit: live && can('units.edit'),
      assign: live && can('units.assign'),
      changeStatus: live && can('units.change_status') && !BOOKING_OWNED.has(u.statusKey) && !SELLER_OWNED.has(u.statusKey),
      archive: live && can('units.archive') && !BOOKING_OWNED.has(u.statusKey) && !SELLER_OWNED.has(u.statusKey),
      manageMedia: live && can('units.manage_media'),
    },
  };
}

export async function viewsOf(principal: Principal, rows: UnitLean[], detail = false) {
  const l = await lookups(principal, rows);
  return rows.map((r) => toView(r, l, principal, detail));
}

// ---- filters ------------------------------------------------------------------

/** Turns validated filters into a Mongo filter. SCOPE is not added here: the scoped repository adds it. */
export function buildFilter(q: UnitFilters): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  if (q.statusId) and.push({ statusId: { $in: q.statusId.map((i) => toObjectId(i)) } });
  for (const f of ['propertyTypeId', 'buildingTypeId', 'locationId'] as const) if (q[f]) and.push({ [f]: toObjectId(q[f]!) });
  if (q.assignedTo === 'unassigned') and.push({ assignedTo: null });
  else if (q.assignedTo) and.push({ assignedTo: toObjectId(q.assignedTo) });
  if (q.minPrice !== undefined || q.maxPrice !== undefined) and.push({ expectedPrice: { ...(q.minPrice !== undefined ? { $gte: q.minPrice } : {}), ...(q.maxPrice !== undefined ? { $lte: q.maxPrice } : {}) } });

  const term = q.search?.trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    const ors: Record<string, unknown>[] = [{ name: rx }, { address: rx }, { city: rx }, { unitCode: new RegExp(`^${escapeRegex(term)}`, 'i') }];
    if (/^\d{1,9}$/.test(term)) ors.push({ unitCode: new RegExp(`^UNT-0*${term.replace(/^0+/, '') || '0'}$`) }); // "42" finds UNT-000042
    and.push({ $or: ors });
  }
  return { $and: and };
}

// ---- reads ------------------------------------------------------------------------

export async function listUnits(principal: Principal, q: z.infer<typeof listUnitQuery>) {
  const filter = buildFilter(q);
  const r = repo(principal, q.branchId, true);
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['createdAt', 'unitCode', 'name', 'expectedPrice', 'builtUpArea', 'statusChangedAt'], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    r.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<UnitLean[]>(),
    r.countDocuments(filter),
  ]);
  return { rows: await viewsOf(principal, rows), meta: toMeta(q, total) };
}

export async function getUnit(principal: Principal, id: string) {
  const u = await repo(principal, undefined, true).findById(id).lean<UnitLean>();
  if (!u) throw AppError.notFound('Unit not found');
  const assignments = await scopedRepo(UnitAssignment, principal).find({ unitId: u._id }).sort({ at: 1, _id: 1 }).lean<{ _id: Id; fromUserId?: Id | null; toUserId: Id; byUserId?: Id; reason?: string; at: Date }[]>();
  const l = await lookups(principal, [u]);
  const peopleIds = [...new Set(assignments.flatMap((a) => [a.fromUserId, a.toUserId, a.byUserId]).filter(Boolean).map((i) => i!.toHexString()))];
  const names = new Map(
    (peopleIds.length ? await scopedRepo(User, principal).find({ _id: { $in: peopleIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : []).map((x) => [x._id.toHexString(), x.name]),
  );
  const name = (i?: Id | null) => (i ? names.get(i.toHexString()) : undefined);
  const booking = await unitBookingPanel(principal, u);
  return {
    ...toView(u, l, principal, true),
    /** Current and past bookings (only for users who may view bookings) and whether they may book or release it now. */
    booking,
    /** Who the unit is sold to, from the one verifiable link: the unit's ACTIVE booking. Never guessed from history or interest. */
    sale: u.statusKey === UNIT_STATUS_KEYS.SOLD ? (booking.visible ? (booking.active ? { state: 'LINKED' as const, booking: booking.active } : { state: 'UNLINKED' as const }) : { state: 'HIDDEN' as const }) : null,
    /** Enquiries considering this unit. Interest changes neither the unit's status nor any booking. */
    interests: await listForUnit(principal, id),
    /** The seller and proposed property this unit was bought from, when it came through Seller Management and the caller may see sellers. */
    acquisition: await unitAcquisition(principal, u._id),
    assignments: assignments.map((a) => ({
      id: a._id.toHexString(), from: a.fromUserId?.toHexString(), fromName: name(a.fromUserId), to: a.toUserId.toHexString(), toName: name(a.toUserId),
      by: a.byUserId?.toHexString(), byName: name(a.byUserId), reason: a.reason, at: a.at,
    })),
  };
}

// ---- create -----------------------------------------------------------------------

const oid = (v?: string | null) => (v ? toObjectId(v) : undefined);
const auditView = (u: UnitLean) => ({
  name: u.name, propertyTypeId: u.propertyTypeId, buildingTypeId: u.buildingTypeId, locationId: u.locationId,
  address: u.address, city: u.city, state: u.state, pincode: u.pincode, latitude: u.latitude, longitude: u.longitude,
  plotArea: u.plotArea, builtUpArea: u.builtUpArea, expectedPrice: u.expectedPrice, bedrooms: u.bedrooms, bathrooms: u.bathrooms, description: u.description,
  statusKey: u.statusKey, assignedTo: u.assignedTo,
});
const refs = (id: Id) => [{ type: 'unit' as const, id }];

export async function createUnit(principal: Principal, input: z.infer<typeof createUnitBody>) {
  const branchId = resolveWriteBranch(principal, input.branchId);
  await validateMasters(principal, branchId, input);
  const assignedTo = input.assignedTo ?? (principal.dataScope === 'OWN' ? principal.userId : undefined);
  if (assignedTo) await validateAssignee(principal, assignedTo, branchId);
  const status = await getUnitStatusByKey(INITIAL_STATUS);

  const unitCode = await nextUnitCode(); // unique and atomic; a failed create below only leaves a gap
  const now = new Date();
  const uid = toObjectId(principal.userId);
  const plain = Object.fromEntries(PLAIN_FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));

  const created = await withTransaction(async (session) => {
    const doc = await repo(principal).create(
      {
        unitCode, branchId: toObjectId(branchId), name: input.name, ...plain,
        propertyTypeId: oid(input.propertyTypeId), buildingTypeId: oid(input.buildingTypeId), locationId: oid(input.locationId),
        statusId: status._id, statusKey: INITIAL_STATUS, statusChangedAt: now,
        assignedTo: oid(assignedTo), assignedAt: assignedTo ? now : undefined,
        createdBy: uid,
      },
      { session },
    );
    const u = doc.toObject() as unknown as UnitLean;
    if (assignedTo) await scopedRepo(UnitAssignment, principal).create({ unitId: u._id, branchId: u.branchId, toUserId: toObjectId(assignedTo), byUserId: uid, at: now }, { session });
    await recordAudit({ entityType: 'unit', entityId: u._id, action: 'create', after: auditView(u), userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'UNIT_CREATED', description: `Unit ${unitCode} (${u.name}) created`, branchId, userId: principal.userId, at: now, refs: refs(u._id) }, { session });
    return u;
  });
  return (await viewsOf(principal, [created], true))[0]!;
}

// ---- update (descriptive fields only) ---------------------------------------------

export async function updateUnit(principal: Principal, id: string, patch: z.infer<typeof updateUnitBody>) {
  const r = repo(principal);
  const before = await r.findById(id).lean<UnitLean>();
  if (!before) throw AppError.notFound('Unit not found');
  const branchId = before.branchId.toHexString();

  // Only a value being CHANGED must be active; an unchanged (possibly since-deactivated) one stays valid.
  const changed: Record<string, string> = {};
  for (const [field] of MASTER_FIELDS) {
    const next = patch[field];
    if (next && next !== before[field]?.toHexString()) changed[field] = next;
  }
  await validateMasters(principal, branchId, changed);

  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) unset[k] = 1;
    else set[k] = (MASTER_FIELDS as readonly (readonly [string, string])[]).some(([f]) => f === k) ? toObjectId(v as string) : v;
  }
  const after = await withTransaction(async (session) => {
    const updated = await r.findOneAndUpdate({ _id: before._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session }).lean<UnitLean>();
    if (!updated) throw AppError.notFound('Unit not found');
    await recordAudit({ entityType: 'unit', entityId: before._id, action: 'update', before: auditView(before), after: auditView(updated), userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'UNIT_UPDATED', description: `Unit ${before.unitCode} updated`, branchId, userId: principal.userId, refs: refs(before._id) }, { session });
    return updated;
  });
  return (await viewsOf(principal, [after], true))[0]!;
}

// ---- assignment -------------------------------------------------------------------

export async function assignUnit(principal: Principal, id: string, input: z.infer<typeof assignBody>) {
  const r = repo(principal);
  const u = await r.findById(id).lean<UnitLean>();
  if (!u) throw AppError.notFound('Unit not found');
  const branchId = u.branchId.toHexString();
  await validateAssignee(principal, input.assignedTo, branchId); // OWN scope: self only; otherwise an active user of THIS branch the actor can see

  const prev = u.assignedTo ?? null;
  if (prev?.toHexString() === input.assignedTo) throw new AppError('NO_CHANGE', 409, 'The unit is already assigned to that person');
  if (prev && !input.reason) throw AppError.validation('A reason is required to reassign a unit', [{ path: 'reason', message: 'Required' }]);

  const now = new Date();
  const uid = toObjectId(principal.userId);
  const to = toObjectId(input.assignedTo);
  const updated = await withTransaction(async (session) => {
    // Conditional on the previous owner: two simultaneous assignments cannot both "win" silently.
    const x = await r.findOneAndUpdate({ _id: u._id, assignedTo: prev }, { $set: { assignedTo: to, assignedAt: now, updatedBy: uid } }, { new: true, session }).lean<UnitLean>();
    if (!x) throw AppError.conflict('ASSIGNMENT_CHANGED', 'The unit was reassigned by someone else. Refresh and try again.');
    await scopedRepo(UnitAssignment, principal).create({ unitId: u._id, branchId: u.branchId, fromUserId: prev ?? undefined, toUserId: to, byUserId: uid, reason: input.reason, at: now }, { session });
    await recordAudit({ entityType: 'unit', entityId: u._id, action: 'assign', before: { assignedTo: prev }, after: { assignedTo: to }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'UNIT_ASSIGNED', description: prev ? `Unit ${u.unitCode} reassigned` : `Unit ${u.unitCode} assigned`, branchId, userId: principal.userId, at: now, refs: refs(u._id), metadata: { from: prev?.toHexString(), to: input.assignedTo } }, { session });
    return x;
  });
  return (await viewsOf(principal, [updated], true))[0]!;
}

// ---- status (controlled) ------------------------------------------------------------

/**
 * The only way a unit's status changes outside booking. The new status must be an ACTIVE UNIT_STATUS value;
 * statuses owned by another operation (BOOKED) can be neither entered nor left here. The change is
 * conditional on the status the caller saw, so a concurrent change (for example a booking) is never overwritten.
 */
export async function changeUnitStatus(principal: Principal, id: string, input: z.infer<typeof statusBody>) {
  const r = repo(principal);
  const u = await r.findById(id).lean<UnitLean>();
  if (!u) throw AppError.notFound('Unit not found');
  if (input.from && input.from !== u.statusId.toHexString()) throw new AppError('STATUS_CHANGED', 409, 'The unit status was changed by someone else. Refresh and try again.');

  const target = await assertActiveMaster(principal, 'UNIT_STATUS', input.statusId, 'statusId');
  const targetKey = await statusKeyOf(target._id);
  if (target._id.equals(u.statusId)) throw new AppError('NO_CHANGE', 409, 'The unit already has that status');
  if (BOOKING_OWNED.has(targetKey) || BOOKING_OWNED.has(u.statusKey)) throw new AppError('BOOKING_OWNED', 409, 'Booked status is managed through bookings, not directly');
  if (SELLER_OWNED.has(targetKey) || SELLER_OWNED.has(u.statusKey)) throw new AppError('SELLER_OWNED', 409, 'This status is managed through Seller Management: the unit becomes available when its property is marked ready to sell');

  const now = new Date();
  const branchId = u.branchId.toHexString();
  const updated = await withTransaction(async (session) => {
    const x = await r.findOneAndUpdate({ _id: u._id, statusId: u.statusId }, { $set: { statusId: target._id, statusKey: targetKey, statusChangedAt: now, updatedBy: toObjectId(principal.userId) } }, { new: true, session }).lean<UnitLean>();
    if (!x) throw new AppError('STATUS_CHANGED', 409, 'The unit status was changed by someone else. Refresh and try again.');
    await recordAudit({ entityType: 'unit', entityId: u._id, action: 'status', before: { statusKey: u.statusKey }, after: { statusKey: targetKey }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'UNIT_STATUS_CHANGED', description: `Unit ${u.unitCode} status changed from ${u.statusKey} to ${targetKey}`, branchId, userId: principal.userId, at: now, refs: refs(u._id), metadata: { from: u.statusKey, to: targetKey, reason: input.reason } }, { session });
    return x;
  });
  return (await viewsOf(principal, [updated], true))[0]!;
}

// ---- archive ------------------------------------------------------------------------

export async function archiveUnit(principal: Principal, id: string) {
  const r = repo(principal);
  const u = await r.findById(id).lean<UnitLean>();
  if (!u) throw AppError.notFound('Unit not found');
  const branchId = u.branchId.toHexString();
  await withTransaction(async (session) => {
    // A booked unit cannot disappear from under its booking; the condition is part of the write, so a booking made meanwhile also blocks it.
    // A unit still being prepared after a seller purchase is likewise held by its seller property until it is released.
    const done = await r.archiveOne({ _id: u._id, statusKey: { $nin: [...BOOKING_OWNED, ...SELLER_OWNED] } }, principal.userId, { session });
    if (!done) {
      const now = await r.findById(id).select('statusKey').lean<{ statusKey: string }>();
      if (now && BOOKING_OWNED.has(now.statusKey)) throw new AppError('UNIT_BOOKED', 409, 'A booked unit cannot be archived. Release the booking first.');
      if (now && SELLER_OWNED.has(now.statusKey)) throw new AppError('SELLER_OWNED', 409, 'This unit is still being prepared through Seller Management and cannot be archived until its property is released.');
      throw AppError.notFound('Unit not found');
    }
    await recordAudit({ entityType: 'unit', entityId: u._id, action: 'archive', before: { isArchived: false }, after: { isArchived: true }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'UNIT_ARCHIVED', description: `Unit ${u.unitCode} archived`, branchId, userId: principal.userId, refs: refs(u._id) }, { session });
  });
}

// ---- media ----------------------------------------------------------------------------

/** Resolves a unit in the caller's scope or throws 404. Runs BEFORE any file is read or uploaded. */
export async function assertUnitAccess(principal: Principal, id: string): Promise<void> {
  if (!(await repo(principal).exists({ _id: toObjectId(id) }))) throw AppError.notFound('Unit not found');
}

export async function listMedia(principal: Principal, id: string) {
  const u = await repo(principal, undefined, true).findById(id).select('media branchId').lean<UnitLean>();
  if (!u) throw AppError.notFound('Unit not found');
  const l = await lookups(principal, [u]);
  return (u.media ?? []).map((m) => mediaView(m, l));
}

export interface UploadedFile {
  buffer: Buffer;
}

export async function addMedia(principal: Principal, id: string, file: UploadedFile | undefined, input: { typeId: string; caption?: string }) {
  const r = repo(principal);
  const u = await r.findById(id).select('unitCode branchId media').lean<UnitLean>();
  if (!u) throw AppError.notFound('Unit not found');
  if (!file || file.buffer.length === 0) throw AppError.validation('Choose a file to upload', [{ path: 'file', message: 'Required' }]);
  const type = await assertActiveMaster(principal, 'MEDIA_TYPE', input.typeId, 'typeId');
  const format = detectFormat(file.buffer);
  if (!format) throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only JPEG, PNG, WebP images and PDF files are accepted');
  const max = getEnv().UNIT_MEDIA_MAX_COUNT;
  if ((u.media?.length ?? 0) >= max) throw new AppError('MEDIA_LIMIT', 409, `A unit can hold at most ${max} files`);

  const branchId = u.branchId.toHexString();
  const asset = await getMediaProvider().upload(file.buffer, { folder: `${getEnv().CLOUDINARY_FOLDER}/units/${id}`, format });
  const item = { _id: new Types.ObjectId(), typeId: type._id, publicId: asset.publicId, url: asset.url, format, bytes: asset.bytes, width: asset.width, height: asset.height, caption: input.caption || undefined, uploadedBy: toObjectId(principal.userId), uploadedAt: new Date() };
  try {
    const updated = await withTransaction(async (session: ClientSession) => {
      // The count condition is part of the write, so simultaneous uploads cannot push a unit past its limit.
      const x = await r.findOneAndUpdate({ _id: u._id, [`media.${max - 1}`]: { $exists: false } }, { $push: { media: item }, $set: { updatedBy: toObjectId(principal.userId) } }, { new: true, session }).lean<UnitLean>();
      if (!x) throw new AppError('MEDIA_LIMIT', 409, `A unit can hold at most ${max} files`);
      await recordAudit({ entityType: 'unit', entityId: u._id, action: 'media_add', after: { mediaId: item._id, typeId: type._id, format, bytes: asset.bytes }, userId: principal.userId, branchId }, { session });
      await recordActivity({ type: 'UNIT_MEDIA_ADDED', description: `${type.label} added to unit ${u.unitCode}`, branchId, userId: principal.userId, refs: refs(u._id), metadata: { mediaId: item._id.toHexString() } }, { session });
      return x;
    });
    const l = await lookups(principal, [updated]);
    return mediaView(updated.media!.find((m) => m._id.equals(item._id))!, l);
  } catch (err) {
    await destroyQuietly(asset.publicId, (o, m) => logger.error(o, m)); // nothing references the file: do not leave it behind
    throw err;
  }
}

export async function removeMedia(principal: Principal, id: string, mediaId: string) {
  const r = repo(principal);
  const mid = toObjectId(mediaId);
  const removed = await withTransaction(async (session) => {
    // Returns the document as it was, which tells us exactly which file was removed; a repeat call finds nothing.
    const before = await r.findOneAndUpdate({ _id: toObjectId(id), 'media._id': mid }, { $pull: { media: { _id: mid } }, $set: { updatedBy: toObjectId(principal.userId) } }, { new: false, session }).lean<UnitLean>();
    if (!before) throw AppError.notFound('Media not found');
    const m = before.media!.find((x) => x._id.equals(mid))!;
    const branchId = before.branchId.toHexString();
    await recordAudit({ entityType: 'unit', entityId: before._id, action: 'media_remove', before: { mediaId: mid, typeId: m.typeId, format: m.format }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'UNIT_MEDIA_REMOVED', description: `A file was removed from unit ${before.unitCode}`, branchId, userId: principal.userId, refs: refs(before._id), metadata: { mediaId } }, { session });
    return m;
  });
  await destroyQuietly(removed.publicId, (o, m) => logger.error(o, m)); // after commit: a failed delete only leaves an orphan, never a dangling record
}
