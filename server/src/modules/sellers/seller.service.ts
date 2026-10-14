import type { ClientSession, Types } from 'mongoose';
import type { z } from 'zod';
import { getEnv } from '../../config/env';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { formatSequence, nextSequence } from '../../core/counters/counter.service';
import type { PermissionKey } from '../../core/permissions/catalog';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { resolveWriteBranch, scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { zonedDayRange } from '../../lib/time';
import { withTransaction } from '../../lib/transaction';
import { Booking } from '../bookings/booking.model';
import { BOOKING_STATUS } from '../bookings/booking.status';
import { Branch } from '../branches/branch.model';
import { assertActiveMaster } from '../masters/master.service';
import { findMatch, isDuplicateKey, materializePerson, personExists, preparePerson } from '../persons/person.service';
import { getUnitStatusByKey } from '../units/unit.masters';
import { Unit, UnitAssignment } from '../units/unit.model';
import { nextUnitCode } from '../units/unit.service';
import { UNIT_STATUS_KEYS } from '../units/unit.status';
import { validateAssignee } from '../users/assignable';
import { User } from '../users/user.model';
import {
  CLOSED_SELLER_STATUSES,
  INITIAL_PROPERTY_STATUS,
  INITIAL_SELLER_STATUS,
  masterByKey,
  OPEN_PROPERTY_STATUSES,
  PROPERTY_STATUS,
  SELLER_STATUS,
  statusLabels,
  TERMINAL_PROPERTY_STATUSES,
  type PropertyStatusKey,
  type SellerStatusKey,
} from './seller.masters';
import { Seller, SellerProperty, SellerPropertyNegotiation, SellerPropertyVerification, SellerPropertyWork, SellerStatusHistory } from './seller.model';
import {
  CHECKLIST_KEYS,
  type addPropertyBody,
  type assignBody,
  type createSellerBody,
  type listPropertyQuery,
  type listSellerQuery,
  type negotiationBody,
  type propertyFilters,
  type purchaseBody,
  type readyToSellBody,
  type refurbishBody,
  type sellerStatusBody,
  type updatePropertyBody,
  type verificationBody,
} from './seller.schema';

export const SELLER_NO = { prefix: 'SEL-', width: 6 } as const;
export const PROPERTY_NO = { prefix: 'SPP-', width: 6 } as const;
const nextSellerNo = async (): Promise<string> => formatSequence(await nextSequence('seller'), SELLER_NO);
const nextPropertyNo = async (): Promise<string> => formatSequence(await nextSequence('sellerProperty'), PROPERTY_NO);

type Id = Types.ObjectId;
export interface SellerLean {
  _id: Id;
  sellerNo: string;
  branchId: Id;
  personId: Id;
  personName: string;
  phoneE164: string;
  statusKey: string;
  statusChangedAt: Date;
  notes?: string | null;
  assignedTo?: Id | null;
  assignedAt?: Date | null;
  isArchived?: boolean;
  createdAt?: Date;
}
export interface PropertyLean {
  _id: Id;
  sellerPropertyNo: string;
  branchId: Id;
  sellerId: Id;
  sellerNo: string;
  name: string;
  propertyTypeId?: Id | null;
  buildingTypeId?: Id | null;
  locationId?: Id | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  plotArea?: number | null;
  builtUpArea?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  description?: string | null;
  askingPrice?: number | null;
  purchasePrice?: number | null;
  purchaseDate?: Date | null;
  purchaseReference?: string | null;
  statusKey: string;
  statusChangedAt: Date;
  assignedTo?: Id | null;
  unitId?: Id | null;
  unitCode?: string | null;
  unitCreatedAt?: Date | null;
  workNotes?: string | null;
  workStartedAt?: Date | null;
  workCompletedAt?: Date | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  workAssignedTo?: Id | null;
  notes?: string | null;
  isArchived?: boolean;
  createdAt?: Date;
}
interface VerificationLean {
  outcome: string;
  checklist?: Record<string, string>;
  verifiedById?: Id | null;
  verifiedAt: Date;
  notes?: string | null;
}
interface HistoryLean {
  _id: Id;
  entityType: string;
  fromStatus?: string | null;
  toStatus: string;
  action: string;
  reason?: string | null;
  notes?: string | null;
  refs?: { type: string; id: Id }[];
  userId?: Id | null;
  at: Date;
}
interface NegotiationLean {
  _id: Id;
  askingPrice?: number | null;
  offeredPrice?: number | null;
  counterPrice?: number | null;
  outcome: string;
  notes?: string | null;
  byUserId?: Id | null;
  discussedOn?: Date | null;
  at: Date;
}
interface WorkLean {
  _id: Id;
  kind: string;
  notes?: string | null;
  startedOn?: Date | null;
  completedOn?: Date | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  workAssignedTo?: Id | null;
  byUserId?: Id | null;
  at: Date;
}

const sellerRepo = (principal: Principal, includeArchived = false) => scopedRepo(Seller, principal, { includeArchived });
const propertyRepo = (principal: Principal, includeArchived = false) => scopedRepo(SellerProperty, principal, { includeArchived });
const can = (principal: Principal, key: PermissionKey): boolean => hasPermission(principal, key);
function assertPermission(principal: Principal, key: PermissionKey): void {
  if (!hasPermission(principal, key)) throw AppError.forbidden(`Missing permission: ${key}`);
}
const changedElsewhere = (what: string) => new AppError('STAGE_CHANGED', 409, `The ${what} was changed by someone else. Refresh and try again.`);

// ---- status rules -------------------------------------------------------------
/**
 * Which property statuses each operation may start from. Written as an explicit allow-map rather than
 * derived from stage order, because the workflow is not a single line: verification and negotiation may
 * overlap, so "is this the next stage?" is the wrong question. Each operation states exactly where it
 * applies, which also makes every refusal directly testable.
 */
const P = PROPERTY_STATUS;
const PROPERTY_FROM = {
  // Verification may be recorded (or redone) while price talks are already under way.
  verify: [P.PROPOSED, P.UNDER_VERIFICATION, P.VERIFIED, P.NEGOTIATION],
  // Negotiation does not have to wait for verification; approval does.
  negotiate: [P.PROPOSED, P.UNDER_VERIFICATION, P.VERIFIED, P.NEGOTIATION],
  approve: [P.VERIFIED, P.NEGOTIATION],
  purchase: [P.APPROVED],
  startWork: [P.PURCHASED],
  work: [P.REFURBISHMENT],
  readyToSell: [P.REFURBISHMENT],
  // Rejecting an APPROVED property reverses an approval, so it additionally needs sellers.approve.
  reject: [P.PROPOSED, P.UNDER_VERIFICATION, P.VERIFIED, P.NEGOTIATION, P.APPROVED],
  withdraw: [P.PROPOSED, P.UNDER_VERIFICATION, P.VERIFIED, P.NEGOTIATION, P.APPROVED],
} as const satisfies Record<string, readonly PropertyStatusKey[]>;
type PropertyOperation = keyof typeof PROPERTY_FROM;
const allowsFrom = (op: PropertyOperation, status: string) => (PROPERTY_FROM[op] as readonly string[]).includes(status);

/** Guards that an operation is legal from the property's current status, naming what is allowed. */
function assertFrom(p: PropertyLean, op: PropertyOperation): void {
  if (TERMINAL_PROPERTY_STATUSES.includes(p.statusKey as PropertyStatusKey)) {
    throw new AppError('TERMINAL_STATUS', 409, `This property is already closed (${p.statusKey})`);
  }
  if (!allowsFrom(op, p.statusKey)) {
    throw new AppError('STAGE_NOT_ALLOWED', 409, `This cannot be done while the property is ${p.statusKey}. Allowed from: ${PROPERTY_FROM[op].join(', ')}`);
  }
}

/** The seller relationship moves, by target. Reactivation returns to REGISTERED, so the seller is verified again. */
const S = SELLER_STATUS;
const SELLER_MOVES: Record<SellerStatusKey, readonly SellerStatusKey[]> = {
  [S.REGISTERED]: [S.VERIFIED, S.REJECTED, S.INACTIVE],
  [S.VERIFIED]: [S.REJECTED, S.INACTIVE],
  [S.REJECTED]: [],
  [S.INACTIVE]: [S.REGISTERED],
};
const sellerTargets = (statusKey: string): readonly SellerStatusKey[] => SELLER_MOVES[statusKey as SellerStatusKey] ?? [];

/** Every check must be PASSED (not just the overall outcome) before a property can be approved or bought. */
function verificationComplete(v: VerificationLean | null | undefined): boolean {
  return Boolean(v && v.outcome === 'PASSED' && CHECKLIST_KEYS.every((k) => v.checklist?.[k] === 'PASSED'));
}

/** What still stands between this property and approval / purchase / release, in plain words. */
function blockers(p: PropertyLean, seller: { statusKey: string } | null, verification: VerificationLean | null): { approve: string[]; purchase: string[]; release: string[] } {
  const prereq: string[] = [];
  if (!verificationComplete(verification)) prereq.push('Verification has not passed on every check');
  if (seller?.statusKey !== S.VERIFIED) prereq.push('The seller has not been verified');
  const release: string[] = [];
  if (!p.unitId) release.push('The purchase has not been completed');
  else if (!p.workStartedAt) release.push('Refurbishment / development has not been started');
  else if (!p.workCompletedAt) release.push('Refurbishment / development has not been completed');
  return { approve: prereq, purchase: prereq, release };
}

async function assertPrerequisites(principal: Principal, p: PropertyLean, what: 'approval' | 'purchase'): Promise<{ seller: SellerLean; verification: VerificationLean }> {
  const [seller, verification] = await Promise.all([
    sellerRepo(principal, true).findById(p.sellerId).lean<SellerLean>(),
    scopedRepo(SellerPropertyVerification, principal).findOne({ sellerPropertyId: p._id }).lean<VerificationLean>(),
  ]);
  if (!seller) throw AppError.notFound('Seller not found');
  if (!verificationComplete(verification)) {
    throw AppError.validation(`Verification must pass on every check before ${what}`, [{ path: 'verification', message: 'Record a verification with every check passed' }]);
  }
  if (seller.statusKey !== S.VERIFIED) {
    throw AppError.validation(`The seller must be verified before ${what}`, [{ path: 'seller', message: 'Verify the seller first' }]);
  }
  return { seller, verification: verification! };
}

// ---- history ------------------------------------------------------------------
/**
 * Appends one immutable status-history row. Called INSIDE the caller's transaction so the history can
 * never disagree with the state it describes: if the transition rolls back, so does its history. The
 * timestamp is the server's, never the client's.
 */
async function appendHistory(
  principal: Principal,
  input: { entityType: 'seller' | 'sellerProperty'; entityId: Id; branchId: Id; fromStatus?: string | null; toStatus: string; action: string; reason?: string | null; notes?: string | null; refs?: { type: string; id: Id }[]; at: Date },
  session: ClientSession,
): Promise<void> {
  await scopedRepo(SellerStatusHistory, principal).create(
    {
      entityType: input.entityType,
      entityId: input.entityId,
      branchId: input.branchId,
      fromStatus: input.fromStatus ?? undefined,
      toStatus: input.toStatus,
      action: input.action,
      reason: input.reason ?? undefined,
      notes: input.notes ?? undefined,
      refs: input.refs ?? [],
      userId: toObjectId(principal.userId),
      at: input.at,
    },
    { session },
  );
}

/** Moves a property's status with compare-and-set on the status the caller saw, plus its history row. */
async function moveProperty(
  principal: Principal,
  p: PropertyLean,
  to: PropertyStatusKey,
  extra: { action: string; reason?: string; notes?: string; set?: Record<string, unknown>; refs?: { type: string; id: Id }[]; at: Date },
  session: ClientSession,
): Promise<PropertyLean> {
  const status = await masterByKey('PROPERTY_STATUS', to);
  const updated = await propertyRepo(principal)
    .findOneAndUpdate(
      { _id: p._id, statusKey: p.statusKey },
      { $set: { ...extra.set, statusId: status._id, statusKey: to, statusChangedAt: extra.at, updatedBy: toObjectId(principal.userId) } },
      { new: true, session },
    )
    .lean<PropertyLean>();
  if (!updated) throw changedElsewhere('property');
  await appendHistory(
    principal,
    { entityType: 'sellerProperty', entityId: p._id, branchId: p.branchId, fromStatus: p.statusKey, toStatus: to, action: extra.action, reason: extra.reason, notes: extra.notes, refs: [{ type: 'seller', id: p.sellerId }, ...(extra.refs ?? [])], at: extra.at },
    session,
  );
  return updated;
}

const propertyRefs = (p: Pick<PropertyLean, '_id' | 'sellerId' | 'unitId'>) => [
  { type: 'sellerProperty' as const, id: p._id },
  { type: 'seller' as const, id: p.sellerId },
  ...(p.unitId ? [{ type: 'unit' as const, id: p.unitId }] : []),
];

// ---- lookups & views ----------------------------------------------------------
/**
 * Everything a page of sellers / properties needs to render, in a fixed number of queries (not per row):
 * status labels, branch and user names, the sellers behind properties, and property counts per seller.
 */
async function lookups(principal: Principal, input: { sellers?: SellerLean[]; properties?: PropertyLean[]; userIds?: (Id | null | undefined)[]; countProperties?: boolean }) {
  const sellers = input.sellers ?? [];
  const properties = input.properties ?? [];
  const ids = (xs: (Id | null | undefined)[]) => [...new Set(xs.filter((x): x is Id => Boolean(x)).map((x) => x.toHexString()))].map((x) => toObjectId(x));
  const userIds = ids([...sellers.map((s) => s.assignedTo), ...properties.flatMap((p) => [p.assignedTo, p.workAssignedTo]), ...(input.userIds ?? [])]);
  const branchIds = ids([...sellers.map((s) => s.branchId), ...properties.map((p) => p.branchId)]);
  const known = new Set(sellers.map((s) => s._id.toHexString()));
  const sellerIds = ids(properties.map((p) => p.sellerId)).filter((i) => !known.has(i.toHexString()));
  const [sellerStatus, propertyStatus, users, branches, owners, counts] = await Promise.all([
    statusLabels('SELLER_STATUS'),
    statusLabels('PROPERTY_STATUS'),
    userIds.length ? scopedRepo(User, principal).find({ _id: { $in: userIds } }).select('name').lean<{ _id: Id; name: string }[]>() : [],
    branchIds.length ? scopedRepo(Branch, principal).find({ _id: { $in: branchIds } }).select('name code').lean<{ _id: Id; name: string; code: string }[]>() : [],
    sellerIds.length ? sellerRepo(principal, true).find({ _id: { $in: sellerIds } }).lean<SellerLean[]>() : [],
    input.countProperties && sellers.length
      ? propertyRepo(principal).find({ sellerId: { $in: sellers.map((s) => s._id) } }).select('sellerId statusKey').lean<{ sellerId: Id; statusKey: string }[]>()
      : [],
  ]);
  const count = new Map<string, { total: number; open: number }>();
  for (const c of counts) {
    const k = c.sellerId.toHexString();
    const e = count.get(k) ?? { total: 0, open: 0 };
    e.total += 1;
    if (OPEN_PROPERTY_STATUSES.includes(c.statusKey as PropertyStatusKey)) e.open += 1;
    count.set(k, e);
  }
  return {
    sellerStatus,
    propertyStatus,
    users: new Map(users.map((u) => [u._id.toHexString(), u.name])),
    branches: new Map(branches.map((b) => [b._id.toHexString(), { name: b.name, code: b.code }])),
    sellers: new Map([...sellers, ...owners].map((s) => [s._id.toHexString(), s])),
    counts: count,
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

const statusOf = (map: Map<string, { label: string; color?: string }>, key: string) => map.get(key) ?? { label: key };
const nameOf = (l: Lookups, id?: Id | null) => (id ? l.users.get(id.toHexString()) : undefined);

function sellerView(principal: Principal, s: SellerLean, l: Lookups) {
  const live = !s.isArchived;
  const counts = l.counts.get(s._id.toHexString());
  const closed = CLOSED_SELLER_STATUSES.includes(s.statusKey as SellerStatusKey);
  const targets = live ? sellerTargets(s.statusKey).filter((t) => t !== S.VERIFIED || can(principal, 'sellers.verify')) : [];
  return {
    id: s._id.toHexString(),
    sellerNo: s.sellerNo,
    branchId: s.branchId.toHexString(),
    branch: l.branches.get(s.branchId.toHexString()),
    personId: s.personId.toHexString(),
    personName: s.personName,
    phoneE164: s.phoneE164,
    statusKey: s.statusKey,
    status: statusOf(l.sellerStatus, s.statusKey),
    statusChangedAt: s.statusChangedAt,
    notes: s.notes ?? undefined,
    assignedTo: s.assignedTo?.toHexString(),
    assignedToName: nameOf(l, s.assignedTo),
    assignedAt: s.assignedAt ?? undefined,
    propertyCount: counts?.total ?? 0,
    openPropertyCount: counts?.open ?? 0,
    isArchived: Boolean(s.isArchived),
    createdAt: s.createdAt,
    /** What this caller may do with the seller now; the UI shows exactly these, the API enforces them again. */
    allowed: {
      edit: live && can(principal, 'sellers.edit'),
      assign: live && can(principal, 'sellers.assign'),
      changeStatus: live && can(principal, 'sellers.edit') && targets.length > 0,
      statusTargets: can(principal, 'sellers.edit') ? targets : [],
      addProperty: live && !closed && can(principal, 'sellers.create'),
      archive: live && can(principal, 'sellers.archive') && (counts?.open ?? 0) === 0,
      scheduleFollowUp: live && can(principal, 'followups.create'),
    },
  };
}

function propertyView(principal: Principal, p: PropertyLean, l: Lookups) {
  const seller = l.sellers.get(p.sellerId.toHexString());
  return {
    id: p._id.toHexString(),
    sellerPropertyNo: p.sellerPropertyNo,
    branchId: p.branchId.toHexString(),
    branch: l.branches.get(p.branchId.toHexString()),
    sellerId: p.sellerId.toHexString(),
    sellerNo: seller?.sellerNo ?? p.sellerNo,
    sellerName: seller?.personName,
    name: p.name,
    propertyTypeId: p.propertyTypeId?.toHexString(),
    buildingTypeId: p.buildingTypeId?.toHexString(),
    locationId: p.locationId?.toHexString(),
    address: p.address ?? undefined,
    city: p.city ?? undefined,
    state: p.state ?? undefined,
    pincode: p.pincode ?? undefined,
    plotArea: p.plotArea ?? undefined,
    builtUpArea: p.builtUpArea ?? undefined,
    bedrooms: p.bedrooms ?? undefined,
    bathrooms: p.bathrooms ?? undefined,
    askingPrice: p.askingPrice ?? undefined,
    purchasePrice: p.purchasePrice ?? undefined,
    purchaseDate: p.purchaseDate ?? undefined,
    purchaseReference: p.purchaseReference ?? undefined,
    statusKey: p.statusKey,
    status: statusOf(l.propertyStatus, p.statusKey),
    statusChangedAt: p.statusChangedAt,
    assignedTo: p.assignedTo?.toHexString(),
    assignedToName: nameOf(l, p.assignedTo),
    unitId: p.unitId?.toHexString(),
    unitCode: p.unitCode ?? undefined,
    unitCreatedAt: p.unitCreatedAt ?? undefined,
    isArchived: Boolean(p.isArchived),
    createdAt: p.createdAt,
    /** The buyer-eligibility flag as the server decides it, so the UI and the API never disagree. */
    eligibleForBuyers: p.statusKey === P.READY_TO_SELL && Boolean(p.unitId),
  };
}

async function propertyDetail(principal: Principal, p: PropertyLean) {
  const [history, negotiations, verification, work, seller] = await Promise.all([
    scopedRepo(SellerStatusHistory, principal).find({ entityType: 'sellerProperty', entityId: p._id }).sort({ at: 1, _id: 1 }).lean<HistoryLean[]>(),
    scopedRepo(SellerPropertyNegotiation, principal).find({ sellerPropertyId: p._id }).sort({ at: -1, _id: -1 }).lean<NegotiationLean[]>(),
    scopedRepo(SellerPropertyVerification, principal).findOne({ sellerPropertyId: p._id }).lean<VerificationLean>(),
    scopedRepo(SellerPropertyWork, principal).find({ sellerPropertyId: p._id }).sort({ at: -1, _id: -1 }).lean<WorkLean[]>(),
    sellerRepo(principal, true).findById(p.sellerId).lean<SellerLean>(),
  ]);
  const l = await lookups(principal, {
    sellers: seller ? [seller] : [],
    properties: [p],
    userIds: [...history.map((h) => h.userId), ...negotiations.map((n) => n.byUserId), verification?.verifiedById, ...work.flatMap((w) => [w.byUserId, w.workAssignedTo])],
  });
  const status = p.statusKey;
  const open = !p.isArchived && !TERMINAL_PROPERTY_STATUSES.includes(status as PropertyStatusKey);
  const b = blockers(p, seller, verification);
  const sellerUsable = seller && !seller.isArchived && !CLOSED_SELLER_STATUSES.includes(seller.statusKey as SellerStatusKey);
  return {
    ...propertyView(principal, p, l),
    description: p.description ?? undefined,
    latitude: p.latitude ?? undefined,
    longitude: p.longitude ?? undefined,
    notes: p.notes ?? undefined,
    workNotes: p.workNotes ?? undefined,
    workStartedAt: p.workStartedAt ?? undefined,
    workCompletedAt: p.workCompletedAt ?? undefined,
    estimatedCost: p.estimatedCost ?? undefined,
    actualCost: p.actualCost ?? undefined,
    workAssignedTo: p.workAssignedTo?.toHexString(),
    workAssignedToName: nameOf(l, p.workAssignedTo),
    seller: seller ? { id: seller._id.toHexString(), sellerNo: seller.sellerNo, personName: seller.personName, phoneE164: seller.phoneE164, statusKey: seller.statusKey, status: statusOf(l.sellerStatus, seller.statusKey), isArchived: Boolean(seller.isArchived) } : null,
    history: history.map((h) => historyView(h, l)),
    negotiations: negotiations.map((n) => ({
      id: n._id.toHexString(),
      askingPrice: n.askingPrice ?? undefined,
      offeredPrice: n.offeredPrice ?? undefined,
      counterPrice: n.counterPrice ?? undefined,
      outcome: n.outcome,
      notes: n.notes ?? undefined,
      byUserId: n.byUserId?.toHexString(),
      byName: nameOf(l, n.byUserId),
      discussedOn: n.discussedOn ?? n.at,
      at: n.at,
    })),
    verification: verification
      ? {
          outcome: verification.outcome,
          checklist: verification.checklist ?? {},
          complete: verificationComplete(verification),
          verifiedById: verification.verifiedById?.toHexString(),
          verifiedByName: nameOf(l, verification.verifiedById),
          verifiedAt: verification.verifiedAt,
          notes: verification.notes ?? undefined,
        }
      : null,
    work: work.map((w) => ({
      id: w._id.toHexString(),
      kind: w.kind,
      notes: w.notes ?? undefined,
      startedOn: w.startedOn ?? undefined,
      completedOn: w.completedOn ?? undefined,
      estimatedCost: w.estimatedCost ?? undefined,
      actualCost: w.actualCost ?? undefined,
      workAssignedToName: nameOf(l, w.workAssignedTo),
      byName: nameOf(l, w.byUserId),
      at: w.at,
    })),
    /** Unmet conditions for the gated steps, so the page can say why an action is not offered. */
    blockers: b,
    /** Exactly what this caller may do right now: permission AND the property's state. */
    allowed: {
      edit: open && !p.unitId && can(principal, 'sellers.edit'),
      verify: open && allowsFrom('verify', status) && can(principal, 'sellers.verify'),
      negotiate: open && allowsFrom('negotiate', status) && can(principal, 'sellers.edit'),
      approve: open && allowsFrom('approve', status) && b.approve.length === 0 && Boolean(sellerUsable) && can(principal, 'sellers.approve'),
      purchase: open && allowsFrom('purchase', status) && b.purchase.length === 0 && Boolean(sellerUsable) && can(principal, 'sellers.purchase'),
      startWork: open && allowsFrom('startWork', status) && can(principal, 'sellers.refurbish'),
      updateWork: open && allowsFrom('work', status) && !p.workCompletedAt && can(principal, 'sellers.refurbish'),
      completeWork: open && allowsFrom('work', status) && !p.workCompletedAt && can(principal, 'sellers.refurbish'),
      release: open && allowsFrom('readyToSell', status) && b.release.length === 0 && can(principal, 'sellers.release'),
      reject: open && allowsFrom('reject', status) && can(principal, 'sellers.edit') && (status !== P.APPROVED || can(principal, 'sellers.approve')),
      withdraw: open && allowsFrom('withdraw', status) && can(principal, 'sellers.edit'),
      scheduleFollowUp: open && status !== P.READY_TO_SELL && can(principal, 'followups.create'),
    },
  };
}

function historyView(h: HistoryLean, l: Lookups) {
  const map = h.entityType === 'seller' ? l.sellerStatus : l.propertyStatus;
  return {
    id: h._id.toHexString(),
    entityType: h.entityType,
    fromStatus: h.fromStatus ?? undefined,
    from: h.fromStatus ? statusOf(map, h.fromStatus) : undefined,
    toStatus: h.toStatus,
    to: statusOf(map, h.toStatus),
    action: h.action,
    reason: h.reason ?? undefined,
    notes: h.notes ?? undefined,
    refs: (h.refs ?? []).map((r) => ({ type: r.type, id: r.id.toHexString() })),
    byUserId: h.userId?.toHexString(),
    byName: nameOf(l, h.userId),
    at: h.at,
  };
}

// ---- master validation --------------------------------------------------------
const MASTER_FIELDS = [
  ['propertyTypeId', 'PROPERTY_TYPE'],
  ['buildingTypeId', 'BUILDING_TYPE'],
  ['locationId', 'LOCATION'],
] as const;

/** New or changed master references must be active and visible; a LOCATION must belong to the property's branch. */
async function validatePropertyMasters(principal: Principal, branchId: string, input: Partial<Record<(typeof MASTER_FIELDS)[number][0], string | null | undefined>>) {
  for (const [field, type] of MASTER_FIELDS) {
    const id = input[field];
    if (typeof id !== 'string' || !id) continue;
    const m = await assertActiveMaster(principal, type, id, field);
    if (type === 'LOCATION' && m.branchId?.toHexString() !== branchId) {
      throw AppError.validation('Invalid location', [{ path: field, message: "Choose a location of this property's branch" }]);
    }
  }
}

/** Business dates (purchase, development, negotiation) are things that have happened: never later than today. */
function assertNotFuture(d: Date | undefined, path: string): void {
  if (!d) return;
  if (d.getTime() >= zonedDayRange(new Date(), getEnv().APP_TIMEZONE).end.getTime()) {
    throw AppError.validation('This date cannot be in the future', [{ path, message: 'Choose today or an earlier date' }]);
  }
}

// ---- seller registration ------------------------------------------------------
type PropertyInput = z.infer<typeof addPropertyBody>;

async function insertProperty(principal: Principal, seller: SellerLean, input: PropertyInput, at: Date, session: ClientSession): Promise<PropertyLean> {
  const status = await masterByKey('PROPERTY_STATUS', INITIAL_PROPERTY_STATUS);
  const oid = (v?: string) => (v ? toObjectId(v) : undefined);
  const doc = await propertyRepo(principal).create(
    {
      sellerPropertyNo: await nextPropertyNo(),
      branchId: seller.branchId,
      sellerId: seller._id,
      sellerNo: seller.sellerNo,
      name: input.name,
      propertyTypeId: oid(input.propertyTypeId),
      buildingTypeId: oid(input.buildingTypeId),
      locationId: oid(input.locationId),
      address: input.address,
      city: input.city,
      state: input.state,
      pincode: input.pincode,
      latitude: input.latitude,
      longitude: input.longitude,
      plotArea: input.plotArea,
      builtUpArea: input.builtUpArea,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      description: input.description,
      askingPrice: input.askingPrice,
      notes: input.notes,
      statusId: status._id,
      statusKey: INITIAL_PROPERTY_STATUS,
      statusChangedAt: at,
      assignedTo: seller.assignedTo ?? undefined,
      createdBy: toObjectId(principal.userId),
    },
    { session },
  );
  const p = doc.toObject() as unknown as PropertyLean;
  await appendHistory(principal, { entityType: 'sellerProperty', entityId: p._id, branchId: p.branchId, toStatus: INITIAL_PROPERTY_STATUS, action: 'registered', refs: [{ type: 'seller', id: seller._id }], at }, session);
  await recordAudit({ entityType: 'sellerProperty', entityId: p._id, action: 'create', after: { sellerPropertyNo: p.sellerPropertyNo, sellerId: seller._id, name: p.name, askingPrice: p.askingPrice, statusKey: p.statusKey }, userId: principal.userId, branchId: p.branchId }, { session });
  await recordActivity({ type: 'SELLER_PROPERTY_CREATED', description: `Proposed property ${p.sellerPropertyNo} (${p.name}) registered for seller ${seller.sellerNo}`, branchId: p.branchId.toHexString(), userId: principal.userId, at, refs: propertyRefs(p) }, { session });
  return p;
}

/** Registers a seller and their first proposed property in ONE transaction, as agreed. */
export async function createSeller(principal: Principal, input: z.infer<typeof createSellerBody>) {
  const branchId = resolveWriteBranch(principal, input.branchId);
  await validatePropertyMasters(principal, branchId, input.property);
  const assignedTo = input.assignedTo ?? (principal.dataScope === 'OWN' ? principal.userId : undefined);
  if (assignedTo) await validateAssignee(principal, assignedTo, branchId);

  // Identity first: an existing phone is reported by preparePerson, never duplicated.
  const prepared = await preparePerson(principal, { personId: input.personId, person: input.person });
  const sellerNo = await nextSellerNo(); // unique and atomic; a failed create below only leaves a gap
  const status = await masterByKey('SELLER_STATUS', INITIAL_SELLER_STATUS);
  const now = new Date();

  try {
    const { s, p } = await withTransaction(async (session) => {
      const person = await materializePerson(principal, prepared, branchId, session);
      const dup = await sellerRepo(principal).findOne({ personId: person._id, branchId: toObjectId(branchId) }).session(session).select('sellerNo').lean<{ _id: Id; sellerNo: string }>();
      if (dup) throw AppError.conflict('SELLER_EXISTS', `This person is already a seller of this branch (${dup.sellerNo}). Add the property to that seller instead.`, { sellerId: dup._id.toHexString(), sellerNo: dup.sellerNo });
      const doc = await sellerRepo(principal).create(
        {
          sellerNo,
          branchId: toObjectId(branchId),
          personId: person._id,
          personName: person.name,
          phoneE164: person.phoneE164,
          statusId: status._id,
          statusKey: INITIAL_SELLER_STATUS,
          statusChangedAt: now,
          notes: input.notes,
          assignedTo: assignedTo ? toObjectId(assignedTo) : undefined,
          assignedAt: assignedTo ? now : undefined,
          createdBy: toObjectId(principal.userId),
        },
        { session },
      );
      const seller = doc.toObject() as unknown as SellerLean;
      await appendHistory(principal, { entityType: 'seller', entityId: seller._id, branchId: seller.branchId, toStatus: INITIAL_SELLER_STATUS, action: 'registered', notes: input.notes, refs: [{ type: 'person', id: person._id }], at: now }, session);
      await recordAudit({ entityType: 'seller', entityId: seller._id, action: 'create', after: { sellerNo, personId: person._id, assignedTo: seller.assignedTo, notes: seller.notes }, userId: principal.userId, branchId }, { session });
      await recordActivity({ type: 'SELLER_CREATED', description: `Seller ${sellerNo} (${seller.personName}) registered`, branchId, userId: principal.userId, at: now, refs: [{ type: 'seller', id: seller._id }, { type: 'person', id: person._id }] }, { session });
      const property = await insertProperty(principal, seller, input.property, now, session);
      return { s: seller, p: property };
    });
    const l = await lookups(principal, { sellers: [s], properties: [p], countProperties: true });
    return { seller: sellerView(principal, s, l), property: propertyView(principal, p, l) };
  } catch (err) {
    // A concurrent writer won a unique index: the seller-per-person-per-branch one is reported like the
    // pre-check; a person created with the same phone meanwhile is reported by the persons module's rule.
    if (isDuplicateKey(err) && (err as { keyPattern?: Record<string, unknown> }).keyPattern?.personId) {
      throw AppError.conflict('SELLER_EXISTS', 'This person is already a seller of this branch. Add the property to that seller instead.');
    }
    if (isDuplicateKey(err) && input.person) throw personExists(await findMatch(principal, input.person.phone));
    throw err;
  }
}

/** Adds another proposed property to an existing seller. A rejected or inactive seller cannot offer new ones. */
export async function addProperty(principal: Principal, sellerId: string, input: PropertyInput) {
  const s = await loadSeller(principal, sellerId);
  if (CLOSED_SELLER_STATUSES.includes(s.statusKey as SellerStatusKey)) {
    throw new AppError('SELLER_CLOSED', 409, `This seller is ${s.statusKey.toLowerCase()} and cannot offer new properties`);
  }
  await validatePropertyMasters(principal, s.branchId.toHexString(), input);
  const p = await withTransaction((session) => insertProperty(principal, s, input, new Date(), session));
  return getProperty(principal, p._id.toHexString());
}

// ---- reads --------------------------------------------------------------------
export async function listSellers(principal: Principal, q: z.infer<typeof listSellerQuery>) {
  const and: Record<string, unknown>[] = [];
  if (q.statusKey) and.push({ statusKey: q.statusKey });
  if (q.assignedTo === 'unassigned') and.push({ $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }] });
  else if (q.assignedTo) and.push({ assignedTo: toObjectId(q.assignedTo) });
  const term = q.search?.trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    const digits = term.replace(/\D/g, '');
    and.push({ $or: [{ personName: rx }, ...(digits.length >= 3 ? [{ phoneE164: new RegExp(escapeRegex(digits)) }] : []), { sellerNo: new RegExp(`^${escapeRegex(term)}`, 'i') }] });
  }
  const archived = q.isArchived === 'true';
  and.push({ isArchived: archived });
  const filter = { $and: and };
  const { skip, limit } = toWindow(q);
  const repo = scopedRepo(Seller, principal, { requestedBranchId: q.branchId, includeArchived: archived });
  const sort = parseSort(q.sort, ['sellerNo', 'personName', 'statusChangedAt', 'createdAt'], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    repo.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<SellerLean[]>(),
    repo.countDocuments(filter),
  ]);
  const l = await lookups(principal, { sellers: rows, countProperties: true });
  return { rows: rows.map((r) => sellerView(principal, r, l)), meta: toMeta(q, total) };
}

export async function getSeller(principal: Principal, id: string) {
  const s = await loadSeller(principal, id, true);
  const [properties, history] = await Promise.all([
    propertyRepo(principal).find({ sellerId: s._id }).sort({ createdAt: -1, _id: -1 }).lean<PropertyLean[]>(),
    scopedRepo(SellerStatusHistory, principal).find({ entityType: 'seller', entityId: s._id }).sort({ at: 1, _id: 1 }).lean<HistoryLean[]>(),
  ]);
  const l = await lookups(principal, { sellers: [s], properties, userIds: history.map((h) => h.userId), countProperties: true });
  return {
    ...sellerView(principal, s, l),
    properties: properties.map((p) => propertyView(principal, p, l)),
    history: history.map((h) => historyView(h, l)),
  };
}

/** The filter shared by the property list and its report, so the two can never disagree. */
export function buildPropertyFilter(q: z.infer<typeof propertyFilters>): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  if (q.sellerId) and.push({ sellerId: toObjectId(q.sellerId) });
  if (q.statusKey) and.push({ statusKey: q.statusKey });
  if (q.hasUnit === 'true') and.push({ unitId: { $type: 'objectId' } });
  if (q.hasUnit === 'false') and.push({ $or: [{ unitId: { $exists: false } }, { unitId: null }] });
  if (q.from || q.to) and.push({ createdAt: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } });
  const term = q.search?.trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    and.push({ $or: [{ name: rx }, { address: rx }, { city: rx }, { sellerPropertyNo: new RegExp(`^${escapeRegex(term)}`, 'i') }, { sellerNo: new RegExp(`^${escapeRegex(term)}`, 'i') }, { unitCode: new RegExp(`^${escapeRegex(term)}`, 'i') }] });
  }
  return { $and: and };
}

/** List views for a page of property rows (used by the list and the report). */
export async function propertyViews(principal: Principal, rows: PropertyLean[]) {
  const l = await lookups(principal, { properties: rows });
  return rows.map((r) => propertyView(principal, r, l));
}

export async function listProperties(principal: Principal, q: z.infer<typeof listPropertyQuery>) {
  const filter = buildPropertyFilter(q);
  const { skip, limit } = toWindow(q);
  const repo = scopedRepo(SellerProperty, principal, { requestedBranchId: q.branchId, includeArchived: q.isArchived === 'true' });
  const sort = parseSort(q.sort, ['sellerPropertyNo', 'name', 'askingPrice', 'statusChangedAt', 'createdAt'], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    repo.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<PropertyLean[]>(),
    repo.countDocuments(filter),
  ]);
  return { rows: await propertyViews(principal, rows), meta: toMeta(q, total) };
}

export async function getProperty(principal: Principal, id: string) {
  return propertyDetail(principal, await loadProperty(principal, id, true));
}

// ---- seller updates -----------------------------------------------------------
export async function updateSeller(principal: Principal, id: string, input: { notes?: string | null }) {
  const s = await loadSeller(principal, id);
  const now = new Date();
  await withTransaction(async (session) => {
    const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
    const unset: Record<string, 1> = {};
    if (input.notes === null) unset.notes = 1;
    else if (input.notes !== undefined) set.notes = input.notes;
    await sellerRepo(principal).updateOne({ _id: s._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session });
    await recordAudit({ entityType: 'seller', entityId: s._id, action: 'update', before: { notes: s.notes }, after: { notes: input.notes ?? undefined }, userId: principal.userId, branchId: s.branchId }, { session });
    await recordActivity({ type: 'SELLER_UPDATED', description: `Seller ${s.sellerNo} updated`, branchId: s.branchId.toHexString(), userId: principal.userId, at: now, refs: [{ type: 'seller', id: s._id }] }, { session });
  });
  return getSeller(principal, id);
}

/**
 * Reassigns the seller. The seller's proposed properties follow in the same transaction, so OWN-scope
 * visibility of a seller and of their properties can never diverge.
 */
export async function assignSeller(principal: Principal, id: string, input: z.infer<typeof assignBody>) {
  const s = await loadSeller(principal, id);
  const branchId = s.branchId.toHexString();
  await validateAssignee(principal, input.assignedTo, branchId);
  const prev = s.assignedTo ?? null;
  if (prev?.toHexString() === input.assignedTo) throw new AppError('NO_CHANGE', 409, 'The seller is already assigned to that person');
  if (prev && !input.reason) throw AppError.validation('A reason is required to reassign a seller', [{ path: 'reason', message: 'Required' }]);
  const now = new Date();
  const uid = toObjectId(principal.userId);
  const to = toObjectId(input.assignedTo);
  await withTransaction(async (session) => {
    const updated = await sellerRepo(principal).findOneAndUpdate({ _id: s._id, assignedTo: prev }, { $set: { assignedTo: to, assignedAt: now, updatedBy: uid } }, { new: true, session }).lean<SellerLean>();
    if (!updated) throw AppError.conflict('ASSIGNMENT_CHANGED', 'The seller was reassigned by someone else. Refresh and try again.');
    await propertyRepo(principal, true).updateMany({ sellerId: s._id }, { $set: { assignedTo: to } }, { session });
    await recordAudit({ entityType: 'seller', entityId: s._id, action: 'assign', before: { assignedTo: prev }, after: { assignedTo: to }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'SELLER_ASSIGNED', description: prev ? `Seller ${s.sellerNo} reassigned` : `Seller ${s.sellerNo} assigned`, branchId, userId: principal.userId, at: now, refs: [{ type: 'seller', id: s._id }], metadata: { from: prev?.toHexString(), to: input.assignedTo, reason: input.reason } }, { session });
  });
  return getSeller(principal, id);
}

/** Archiving hides a seller whose dealings are over. Open proposals must be closed (rejected / withdrawn) first. */
export async function archiveSeller(principal: Principal, id: string) {
  const s = await loadSeller(principal, id);
  const open = await propertyRepo(principal).countDocuments({ sellerId: s._id, statusKey: { $in: OPEN_PROPERTY_STATUSES } });
  if (open > 0) throw AppError.conflict('SELLER_HAS_OPEN_PROPERTIES', 'This seller still has proposed properties under consideration. Reject or withdraw them first.', { open });
  const branchId = s.branchId.toHexString();
  await withTransaction(async (session) => {
    if (!(await sellerRepo(principal).archiveOne({ _id: s._id }, principal.userId, { session }))) throw AppError.notFound('Seller not found');
    await recordAudit({ entityType: 'seller', entityId: s._id, action: 'archive', before: { isArchived: false }, after: { isArchived: true }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'SELLER_ARCHIVED', description: `Seller ${s.sellerNo} archived`, branchId, userId: principal.userId, refs: [{ type: 'seller', id: s._id }] }, { session });
  });
}

/** Moves the SELLER relationship status (verify / reject / deactivate / reactivate), with history. */
export async function changeSellerStatus(principal: Principal, id: string, input: z.infer<typeof sellerStatusBody>) {
  const s = await loadSeller(principal, id);
  if (s.statusKey === input.to) throw new AppError('NO_CHANGE', 409, `The seller is already ${input.to}`);
  if (!sellerTargets(s.statusKey).includes(input.to)) {
    throw new AppError('STAGE_NOT_ALLOWED', 409, `A ${s.statusKey} seller cannot be moved to ${input.to}`);
  }
  if (input.to === S.VERIFIED) assertPermission(principal, 'sellers.verify');
  const status = await masterByKey('SELLER_STATUS', input.to);
  const now = new Date();
  const branchId = s.branchId.toHexString();
  await withTransaction(async (session) => {
    const updated = await sellerRepo(principal)
      .findOneAndUpdate({ _id: s._id, statusKey: s.statusKey }, { $set: { statusId: status._id, statusKey: input.to, statusChangedAt: now, updatedBy: toObjectId(principal.userId) } }, { new: true, session })
      .lean<SellerLean>();
    if (!updated) throw changedElsewhere('seller');
    await appendHistory(principal, { entityType: 'seller', entityId: s._id, branchId: s.branchId, fromStatus: s.statusKey, toStatus: input.to, action: 'status', reason: input.reason, refs: [{ type: 'person', id: s.personId }], at: now }, session);
    await recordAudit({ entityType: 'seller', entityId: s._id, action: 'status', before: { statusKey: s.statusKey }, after: { statusKey: input.to }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'SELLER_STATUS_CHANGED', description: `Seller ${s.sellerNo} moved from ${s.statusKey} to ${input.to}: ${input.reason}`, branchId, userId: principal.userId, at: now, refs: [{ type: 'seller', id: s._id }], metadata: { from: s.statusKey, to: input.to } }, { session });
  });
  return getSeller(principal, id);
}

// ---- property updates ---------------------------------------------------------
export async function updateProperty(principal: Principal, id: string, input: z.infer<typeof updatePropertyBody>) {
  const p = await loadProperty(principal, id);
  // Once a Unit exists the inventory record is authoritative; editing both would let them drift apart.
  if (p.unitId) throw new AppError('PROPERTY_IS_UNIT', 409, `This property is now unit ${p.unitCode}. Edit the unit instead.`);
  if (TERMINAL_PROPERTY_STATUSES.includes(p.statusKey as PropertyStatusKey)) throw new AppError('TERMINAL_STATUS', 409, `This property is already closed (${p.statusKey})`);
  const changed: Record<string, string> = {};
  for (const [field] of MASTER_FIELDS) {
    const next = input[field];
    if (next && next !== p[field]?.toHexString()) changed[field] = next;
  }
  await validatePropertyMasters(principal, p.branchId.toHexString(), changed);
  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === null) unset[k] = 1;
    else if (v !== undefined) set[k] = (MASTER_FIELDS as readonly (readonly [string, string])[]).some(([f]) => f === k) ? toObjectId(v as string) : v;
  }
  const branchId = p.branchId.toHexString();
  await withTransaction(async (session) => {
    const updated = await propertyRepo(principal)
      .findOneAndUpdate({ _id: p._id, $or: [{ unitId: { $exists: false } }, { unitId: null }] }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session })
      .lean<PropertyLean>();
    if (!updated) throw changedElsewhere('property');
    const pick = (x: PropertyLean) => Object.fromEntries(Object.keys(input).map((k) => [k, x[k as keyof PropertyLean]]));
    await recordAudit({ entityType: 'sellerProperty', entityId: p._id, action: 'update', before: pick(p), after: pick(updated), userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'SELLER_PROPERTY_UPDATED', description: `Proposed property ${p.sellerPropertyNo} updated`, branchId, userId: principal.userId, refs: propertyRefs(p) }, { session });
  });
  return getProperty(principal, id);
}

/**
 * Records a verification (checklist + verifier + notes). One current record per property, replaced on
 * re-verification; the audit log keeps every earlier checklist and the history keeps every status move.
 *
 * Status: before price talks, a full pass moves the property to VERIFIED and anything else to
 * UNDER_VERIFICATION. Once in NEGOTIATION the status stays (the two run side by side) and the outcome
 * shows on the verification record — approval still requires it to have passed.
 */
export async function verifyProperty(principal: Principal, id: string, input: z.infer<typeof verificationBody>) {
  assertPermission(principal, 'sellers.verify');
  const p = await loadProperty(principal, id);
  assertFrom(p, 'verify');
  const now = new Date();
  const uid = toObjectId(principal.userId);
  const branchId = p.branchId.toHexString();
  const verRepo = scopedRepo(SellerPropertyVerification, principal);
  const existing = await verRepo.findOne({ sellerPropertyId: p._id }).lean<VerificationLean>();
  // A re-verification reports only the checks it actually did, so merge onto what is already recorded.
  const checklist: Record<string, string> = { ...Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, 'PENDING'])), ...(existing?.checklist ?? {}), ...input.checklist };
  if (input.outcome === 'PASSED') {
    const open = CHECKLIST_KEYS.filter((k) => checklist[k] !== 'PASSED');
    if (open.length) throw AppError.validation('A verification can only pass when every check has passed', open.map((k) => ({ path: `checklist.${k}`, message: `${k} is ${checklist[k]}` })));
  }
  const target: PropertyStatusKey = p.statusKey === P.NEGOTIATION ? P.NEGOTIATION : input.outcome === 'PASSED' ? P.VERIFIED : P.UNDER_VERIFICATION;

  await withTransaction(async (session) => {
    if (existing) {
      await verRepo.updateOne({ sellerPropertyId: p._id }, { $set: { outcome: input.outcome, checklist, verifiedById: uid, verifiedAt: now, notes: input.notes } }, { session });
    } else {
      await verRepo.create({ sellerPropertyId: p._id, branchId: p.branchId, outcome: input.outcome, checklist, verifiedById: uid, verifiedAt: now, notes: input.notes }, { session });
    }
    const notes = `Verification ${input.outcome}${input.notes ? `: ${input.notes}` : ''}`;
    if (target !== p.statusKey) {
      await moveProperty(principal, p, target, { action: 'verified', reason: input.reason, notes, at: now }, session);
    } else {
      // Same status, new outcome: still a recorded decision on the property's timeline of states.
      const touched = await propertyRepo(principal).findOneAndUpdate({ _id: p._id, statusKey: p.statusKey }, { $set: { updatedBy: uid } }, { session }).lean();
      if (!touched) throw changedElsewhere('property');
      await appendHistory(principal, { entityType: 'sellerProperty', entityId: p._id, branchId: p.branchId, fromStatus: p.statusKey, toStatus: p.statusKey, action: 'verified', reason: input.reason, notes, refs: [{ type: 'seller', id: p.sellerId }], at: now }, session);
    }
    await recordAudit({ entityType: 'sellerProperty', entityId: p._id, action: 'verify', before: { statusKey: p.statusKey, outcome: existing?.outcome, checklist: existing?.checklist }, after: { statusKey: target, outcome: input.outcome, checklist }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'SELLER_PROPERTY_VERIFIED', description: `Proposed property ${p.sellerPropertyNo} verification ${input.outcome}`, branchId, userId: principal.userId, at: now, refs: propertyRefs(p), metadata: { outcome: input.outcome } }, { session });
  });
  return getProperty(principal, id);
}

/** Appends one negotiation round (never overwrites earlier ones). The first round moves the property to NEGOTIATION. */
export async function recordNegotiation(principal: Principal, id: string, input: z.infer<typeof negotiationBody>) {
  const p = await loadProperty(principal, id);
  assertFrom(p, 'negotiate');
  assertNotFuture(input.discussedOn, 'discussedOn');
  const now = new Date();
  const branchId = p.branchId.toHexString();
  await withTransaction(async (session) => {
    await scopedRepo(SellerPropertyNegotiation, principal).create(
      { sellerPropertyId: p._id, branchId: p.branchId, askingPrice: input.askingPrice, offeredPrice: input.offeredPrice, counterPrice: input.counterPrice, outcome: input.outcome, notes: input.notes, discussedOn: input.discussedOn, byUserId: toObjectId(principal.userId), at: now },
      { session },
    );
    if (p.statusKey !== P.NEGOTIATION) await moveProperty(principal, p, P.NEGOTIATION, { action: 'negotiation', notes: input.notes, at: now }, session);
    const prices = [input.askingPrice !== undefined && `asking ${input.askingPrice}`, input.offeredPrice !== undefined && `offered ${input.offeredPrice}`, input.counterPrice !== undefined && `counter ${input.counterPrice}`].filter(Boolean).join(', ');
    await recordActivity({ type: 'SELLER_PROPERTY_NEGOTIATION', description: `Negotiation on ${p.sellerPropertyNo}: ${prices} (${input.outcome.toLowerCase()})`, branchId, userId: principal.userId, at: now, refs: propertyRefs(p), metadata: { askingPrice: input.askingPrice, offeredPrice: input.offeredPrice, counterPrice: input.counterPrice, outcome: input.outcome } }, { session });
  });
  return getProperty(principal, id);
}

/** Approval for purchase. Requires every verification check passed and the seller verified. */
export async function approveProperty(principal: Principal, id: string, input: { reason: string }) {
  assertPermission(principal, 'sellers.approve');
  const p = await loadProperty(principal, id);
  assertFrom(p, 'approve');
  await assertPrerequisites(principal, p, 'approval');
  const now = new Date();
  const branchId = p.branchId.toHexString();
  await withTransaction(async (session) => {
    await moveProperty(principal, p, P.APPROVED, { action: 'approved', reason: input.reason, at: now }, session);
    await recordAudit({ entityType: 'sellerProperty', entityId: p._id, action: 'approve', before: { statusKey: p.statusKey }, after: { statusKey: P.APPROVED }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'SELLER_PROPERTY_APPROVED', description: `Proposed property ${p.sellerPropertyNo} approved for purchase: ${input.reason}`, branchId, userId: principal.userId, at: now, refs: propertyRefs(p) }, { session });
  });
  return getProperty(principal, id);
}

// ---- purchase + unit creation -------------------------------------------------
/**
 * Records the purchase and creates EXACTLY ONE Unit, in one transaction.
 *
 * The Unit is created UNDER_DEVELOPMENT (a status only this module can move it out of), so the new stock
 * is in inventory but never offered to buyers, counted as available, or bookable until it is released.
 *
 * Duplicate prevention is layered:
 *  1. The property is claimed with compare-and-set on `statusKey: APPROVED` AND an absent `unitId`; a
 *     concurrent second call either loses the write conflict (and is retried by the driver, then sees the
 *     link) or matches nothing.
 *  2. The link is stamped in the same transaction as the Unit insert, and `one_property_per_unit` makes
 *     the database refuse a second link outright.
 *  3. Repeating the call on an already-purchased property returns the existing link (`unitCreated: false`)
 *     instead of failing, so a double-click or a retried request is harmless.
 */
export async function completePurchase(principal: Principal, id: string, input: z.infer<typeof purchaseBody>) {
  assertPermission(principal, 'sellers.purchase');
  const p = await loadProperty(principal, id);
  if (p.unitId) return { ...(await getProperty(principal, id)), unitCreated: false };
  assertFrom(p, 'purchase');
  assertNotFuture(input.purchaseDate, 'purchaseDate');
  await assertPrerequisites(principal, p, 'purchase');
  const branchId = p.branchId.toHexString();
  await validatePropertyMasters(principal, branchId, input);

  // Who looks after the new Unit: an explicit choice must be valid; the default (the seller's handler) is
  // used only if that person can still be assigned, and never blocks the purchase.
  let assignedTo = input.assignedTo;
  if (assignedTo) await validateAssignee(principal, assignedTo, branchId);
  else if (p.assignedTo) {
    try {
      await validateAssignee(principal, p.assignedTo.toHexString(), branchId);
      assignedTo = p.assignedTo.toHexString();
    } catch {
      assignedTo = undefined;
    }
  }

  const [propertyStatus, unitStatus] = await Promise.all([masterByKey('PROPERTY_STATUS', P.PURCHASED), getUnitStatusByKey(UNIT_STATUS_KEYS.UNDER_DEVELOPMENT)]);
  const now = new Date();
  const uid = toObjectId(principal.userId);

  const result = await withTransaction(async (session) => {
    const unclaimed = { $or: [{ unitId: { $exists: false } }, { unitId: null }] };
    const claimed = await propertyRepo(principal)
      .findOneAndUpdate({ _id: p._id, statusKey: P.APPROVED, ...unclaimed }, { $set: { purchasePrice: input.finalPrice, purchaseDate: input.purchaseDate, purchaseReference: input.purchaseReference, updatedBy: uid } }, { new: true, session })
      .lean<PropertyLean>();
    if (!claimed) {
      const current = await propertyRepo(principal, true).findById(p._id).session(session).lean<PropertyLean>();
      if (current?.unitId) return { created: false as const };
      throw changedElsewhere('property');
    }

    const unitCode = await nextUnitCode(); // unique and atomic; a rolled-back attempt only leaves a gap
    const oid = (override: string | undefined, own: Id | null | undefined) => (override ? toObjectId(override) : own ?? undefined);
    const plain = Object.fromEntries(
      (['address', 'city', 'state', 'pincode', 'latitude', 'longitude', 'plotArea', 'builtUpArea', 'bedrooms', 'bathrooms', 'description'] as const).map((f) => [f, claimed[f]]).filter(([, v]) => v != null),
    );
    const unitDoc = await scopedRepo(Unit, principal).create(
      {
        unitCode,
        branchId: p.branchId,
        name: claimed.name,
        ...plain,
        propertyTypeId: oid(input.propertyTypeId, claimed.propertyTypeId),
        buildingTypeId: oid(input.buildingTypeId, claimed.buildingTypeId),
        locationId: oid(input.locationId, claimed.locationId),
        // No expectedPrice: what the company paid is not what it will sell for. It is set on release.
        statusId: unitStatus._id,
        statusKey: UNIT_STATUS_KEYS.UNDER_DEVELOPMENT,
        statusChangedAt: now,
        assignedTo: assignedTo ? toObjectId(assignedTo) : undefined,
        assignedAt: assignedTo ? now : undefined,
        createdBy: uid,
      },
      { session },
    );
    const unit = unitDoc.toObject() as { _id: Id; unitCode: string; name: string };
    if (assignedTo) await scopedRepo(UnitAssignment, principal).create({ unitId: unit._id, branchId: p.branchId, toUserId: toObjectId(assignedTo), byUserId: uid, reason: `Purchased from seller (${p.sellerPropertyNo})`, at: now }, { session });

    // The link is set in the same transaction as the Unit, so seller ↔ unit can never be half-written.
    const linked = await propertyRepo(principal)
      .findOneAndUpdate(
        { _id: p._id, statusKey: P.APPROVED, ...unclaimed },
        { $set: { statusId: propertyStatus._id, statusKey: P.PURCHASED, statusChangedAt: now, unitId: unit._id, unitCode, unitCreatedAt: now, updatedBy: uid } },
        { new: true, session },
      )
      .lean<PropertyLean>();
    if (!linked) throw changedElsewhere('property');

    await appendHistory(principal, { entityType: 'sellerProperty', entityId: p._id, branchId: p.branchId, fromStatus: P.APPROVED, toStatus: P.PURCHASED, action: 'purchased', reason: input.reason, notes: `Purchased for ${input.finalPrice} (ref. ${input.purchaseReference}); unit ${unitCode} created`, refs: [{ type: 'seller', id: p.sellerId }, { type: 'unit', id: unit._id }], at: now }, session);
    await recordAudit({ entityType: 'sellerProperty', entityId: p._id, action: 'purchase', before: { statusKey: P.APPROVED }, after: { statusKey: P.PURCHASED, unitId: unit._id, unitCode, purchasePrice: input.finalPrice, purchaseDate: input.purchaseDate, purchaseReference: input.purchaseReference }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordAudit({ entityType: 'unit', entityId: unit._id, action: 'create', after: { unitCode, name: unit.name, statusKey: UNIT_STATUS_KEYS.UNDER_DEVELOPMENT, assignedTo, fromSellerProperty: p.sellerPropertyNo }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'UNIT_CREATED', description: `Unit ${unitCode} (${unit.name}) created from seller property ${p.sellerPropertyNo}`, branchId, userId: principal.userId, at: now, refs: [{ type: 'unit', id: unit._id }, { type: 'sellerProperty', id: p._id }] }, { session });
    await recordActivity({ type: 'SELLER_PROPERTY_PURCHASED', description: `Purchase of ${p.sellerPropertyNo} completed; unit ${unitCode} created and held under development`, branchId, userId: principal.userId, at: now, refs: propertyRefs({ ...p, unitId: unit._id }), metadata: { finalPrice: input.finalPrice, purchaseReference: input.purchaseReference } }, { session });
    return { created: true as const };
  });

  return { ...(await getProperty(principal, id)), unitCreated: result.created };
}

// ---- refurbishment / development ------------------------------------------------
/** Starts, updates or completes development work, appending to the work log each time. */
export async function recordWork(principal: Principal, id: string, input: z.infer<typeof refurbishBody>) {
  assertPermission(principal, 'sellers.refurbish');
  const p = await loadProperty(principal, id);
  assertFrom(p, input.action === 'start' ? 'startWork' : 'work');
  if (input.action !== 'start' && p.workCompletedAt) throw new AppError('WORK_COMPLETED', 409, 'Development is already recorded as complete');
  assertNotFuture(input.startedOn, 'startedOn');
  assertNotFuture(input.completedOn, 'completedOn');
  const startedOn = input.action === 'start' ? (input.startedOn ?? new Date()) : undefined;
  const completedOn = input.action === 'complete' ? (input.completedOn ?? new Date()) : undefined;
  const effectiveStart = startedOn ?? p.workStartedAt ?? undefined;
  if (completedOn && effectiveStart && completedOn.getTime() < zonedDayRange(new Date(effectiveStart), getEnv().APP_TIMEZONE).start.getTime()) {
    throw AppError.validation('Work cannot finish before it started', [{ path: 'completedOn', message: 'Choose a date on or after the start' }]);
  }
  const branchId = p.branchId.toHexString();
  if (input.workAssignedTo) await validateAssignee(principal, input.workAssignedTo, branchId);
  const now = new Date();
  const uid = toObjectId(principal.userId);

  await withTransaction(async (session) => {
    const set: Record<string, unknown> = { updatedBy: uid };
    if (input.workNotes !== undefined) set.workNotes = input.workNotes;
    if (input.estimatedCost !== undefined) set.estimatedCost = input.estimatedCost;
    if (input.actualCost !== undefined) set.actualCost = input.actualCost;
    if (input.workAssignedTo) set.workAssignedTo = toObjectId(input.workAssignedTo);
    if (startedOn) set.workStartedAt = startedOn;
    if (completedOn) set.workCompletedAt = completedOn;

    if (input.action === 'start') {
      await moveProperty(principal, p, P.REFURBISHMENT, { action: 'workStarted', reason: input.reason, notes: input.workNotes, set, refs: p.unitId ? [{ type: 'unit', id: p.unitId }] : [], at: now }, session);
    } else {
      const updated = await propertyRepo(principal).findOneAndUpdate({ _id: p._id, statusKey: P.REFURBISHMENT, workCompletedAt: p.workCompletedAt ?? null }, { $set: set }, { new: true, session }).lean();
      if (!updated) throw changedElsewhere('property');
    }
    await scopedRepo(SellerPropertyWork, principal).create(
      { sellerPropertyId: p._id, branchId: p.branchId, unitId: p.unitId ?? undefined, kind: input.action.toUpperCase(), notes: input.workNotes, startedOn, completedOn, estimatedCost: input.estimatedCost, actualCost: input.actualCost, workAssignedTo: input.workAssignedTo ? toObjectId(input.workAssignedTo) : undefined, byUserId: uid, at: now },
      { session },
    );
    await recordAudit({ entityType: 'sellerProperty', entityId: p._id, action: `work_${input.action}`, before: { workStartedAt: p.workStartedAt, workCompletedAt: p.workCompletedAt, estimatedCost: p.estimatedCost, actualCost: p.actualCost, workAssignedTo: p.workAssignedTo }, after: set, reason: input.reason, userId: principal.userId, branchId }, { session });
    const type = input.action === 'start' ? 'SELLER_PROPERTY_REFURB_STARTED' : input.action === 'complete' ? 'SELLER_PROPERTY_WORK_COMPLETED' : 'SELLER_PROPERTY_WORK_UPDATED';
    const verb = input.action === 'start' ? 'started' : input.action === 'complete' ? 'completed' : 'updated';
    await recordActivity({ type, description: `Development ${verb} on ${p.sellerPropertyNo} (unit ${p.unitCode})${input.workNotes ? `: ${input.workNotes}` : ''}`, branchId, userId: principal.userId, at: now, refs: propertyRefs(p) }, { session });
  });
  return getProperty(principal, id);
}

// ---- ready to sell ------------------------------------------------------------
/**
 * Releases the property to buyers: the property becomes READY_TO_SELL and its Unit moves from
 * UNDER_DEVELOPMENT to AVAILABLE, in ONE transaction with both histories (property status history and the
 * unit's status audit). Requires the purchase and the completed development, and does not bypass any
 * inventory rule: an archived, booked, sold or otherwise held unit is refused.
 */
export async function markReadyToSell(principal: Principal, id: string, input: z.infer<typeof readyToSellBody>) {
  assertPermission(principal, 'sellers.release');
  const p = await loadProperty(principal, id);
  assertFrom(p, 'readyToSell');
  if (!p.unitId) throw new AppError('NO_UNIT', 409, 'This property has no unit yet, so it cannot be offered to buyers');
  if (!p.workStartedAt || !p.workCompletedAt) throw new AppError('REFURBISHMENT_INCOMPLETE', 409, 'Record the refurbishment / development as complete before marking ready to sell');

  const unitRepo = scopedRepo(Unit, principal, { includeArchived: true });
  const unit = await unitRepo.findById(p.unitId).lean<{ _id: Id; unitCode: string; statusKey: string; isArchived?: boolean; expectedPrice?: number | null }>();
  if (!unit) throw AppError.notFound('The unit for this property no longer exists or is not visible to you');
  if (unit.isArchived) throw new AppError('UNIT_ARCHIVED', 409, `Unit ${unit.unitCode} is archived and cannot be offered to buyers`);
  if (unit.statusKey !== UNIT_STATUS_KEYS.UNDER_DEVELOPMENT && unit.statusKey !== UNIT_STATUS_KEYS.AVAILABLE) {
    throw new AppError('UNIT_NOT_AVAILABLE', 409, `Unit ${unit.unitCode} is ${unit.statusKey}. Only a unit under development or available can be released to buyers`);
  }
  if (await scopedRepo(Booking, principal).exists({ unitId: unit._id, status: BOOKING_STATUS.active })) {
    throw new AppError('UNIT_NOT_AVAILABLE', 409, `Unit ${unit.unitCode} has an active booking`);
  }

  const available = await getUnitStatusByKey(UNIT_STATUS_KEYS.AVAILABLE);
  const now = new Date();
  const uid = toObjectId(principal.userId);
  const branchId = p.branchId.toHexString();
  const priceSet = input.expectedPrice !== undefined ? { expectedPrice: input.expectedPrice } : {};
  await withTransaction(async (session) => {
    const liveUnit = { _id: unit._id, isArchived: { $ne: true } };
    if (unit.statusKey === UNIT_STATUS_KEYS.UNDER_DEVELOPMENT) {
      const x = await unitRepo.findOneAndUpdate({ ...liveUnit, statusKey: UNIT_STATUS_KEYS.UNDER_DEVELOPMENT }, { $set: { statusId: available._id, statusKey: UNIT_STATUS_KEYS.AVAILABLE, statusChangedAt: now, updatedBy: uid, ...priceSet } }, { new: true, session }).lean();
      if (!x) throw new AppError('STATUS_CHANGED', 409, 'The unit status was changed by someone else. Refresh and try again.');
      // The unit's own status history, on the same convention as every other unit status change.
      await recordAudit({ entityType: 'unit', entityId: unit._id, action: 'status', before: { statusKey: UNIT_STATUS_KEYS.UNDER_DEVELOPMENT, ...(input.expectedPrice !== undefined ? { expectedPrice: unit.expectedPrice } : {}) }, after: { statusKey: UNIT_STATUS_KEYS.AVAILABLE, ...priceSet }, reason: `Released to buyers: ${p.sellerPropertyNo}${input.reason ? ` (${input.reason})` : ''}`, userId: principal.userId, branchId }, { session });
      await recordActivity({ type: 'UNIT_STATUS_CHANGED', description: `Unit ${unit.unitCode} status changed from ${UNIT_STATUS_KEYS.UNDER_DEVELOPMENT} to ${UNIT_STATUS_KEYS.AVAILABLE} (released from seller property ${p.sellerPropertyNo})`, branchId, userId: principal.userId, at: now, refs: [{ type: 'unit', id: unit._id }, { type: 'sellerProperty', id: p._id }], metadata: { from: UNIT_STATUS_KEYS.UNDER_DEVELOPMENT, to: UNIT_STATUS_KEYS.AVAILABLE, reason: input.reason } }, { session });
    } else {
      // Already AVAILABLE (a unit created before units were held under development): status stays, still verified as live and available.
      const x = await unitRepo.findOneAndUpdate({ ...liveUnit, statusKey: UNIT_STATUS_KEYS.AVAILABLE }, { $set: { updatedBy: uid, ...priceSet } }, { new: true, session }).lean();
      if (!x) throw new AppError('STATUS_CHANGED', 409, 'The unit status was changed by someone else. Refresh and try again.');
      if (input.expectedPrice !== undefined) await recordAudit({ entityType: 'unit', entityId: unit._id, action: 'update', before: { expectedPrice: unit.expectedPrice }, after: priceSet, userId: principal.userId, branchId }, { session });
    }
    await moveProperty(principal, p, P.READY_TO_SELL, { action: 'readyToSell', reason: input.reason, refs: [{ type: 'unit', id: unit._id }], at: now }, session);
    await recordAudit({ entityType: 'sellerProperty', entityId: p._id, action: 'readyToSell', before: { statusKey: p.statusKey }, after: { statusKey: P.READY_TO_SELL, unitCode: unit.unitCode }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'SELLER_PROPERTY_READY_TO_SELL', description: `${p.sellerPropertyNo} marked ready to sell; unit ${unit.unitCode} is now available to buyers`, branchId, userId: principal.userId, at: now, refs: propertyRefs(p) }, { session });
  });
  return getProperty(principal, id);
}

// ---- closing a proposal -------------------------------------------------------
/** The company declines the property. Reversing an approval this way needs the approver's permission. */
export async function rejectProperty(principal: Principal, id: string, input: { reason: string }) {
  const p = await loadProperty(principal, id);
  assertFrom(p, 'reject');
  if (p.statusKey === P.APPROVED) assertPermission(principal, 'sellers.approve');
  return closeProperty(principal, p, P.REJECTED, 'rejected', 'SELLER_PROPERTY_REJECTED', input.reason);
}

/** The seller takes the offer back. */
export async function withdrawProperty(principal: Principal, id: string, input: { reason: string }) {
  const p = await loadProperty(principal, id);
  assertFrom(p, 'withdraw');
  return closeProperty(principal, p, P.WITHDRAWN, 'withdrawn', 'SELLER_PROPERTY_WITHDRAWN', input.reason);
}

async function closeProperty(principal: Principal, p: PropertyLean, to: PropertyStatusKey, action: string, activity: 'SELLER_PROPERTY_REJECTED' | 'SELLER_PROPERTY_WITHDRAWN', reason: string) {
  const now = new Date();
  const branchId = p.branchId.toHexString();
  await withTransaction(async (session) => {
    await moveProperty(principal, p, to, { action, reason, at: now }, session);
    await recordAudit({ entityType: 'sellerProperty', entityId: p._id, action, before: { statusKey: p.statusKey }, after: { statusKey: to }, reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: activity, description: `Proposed property ${p.sellerPropertyNo} ${action}: ${reason}`, branchId, userId: principal.userId, at: now, refs: propertyRefs(p) }, { session });
  });
  return getProperty(principal, p._id.toHexString());
}

// ---- loaders ------------------------------------------------------------------
async function loadSeller(principal: Principal, id: string, includeArchived = false): Promise<SellerLean> {
  const s = await sellerRepo(principal, includeArchived).findById(id).lean<SellerLean>();
  if (!s) throw AppError.notFound('Seller not found');
  return s;
}
async function loadProperty(principal: Principal, id: string, includeArchived = false): Promise<PropertyLean> {
  const p = await propertyRepo(principal, includeArchived).findById(id).lean<PropertyLean>();
  if (!p) throw AppError.notFound('Proposed property not found');
  return p;
}
