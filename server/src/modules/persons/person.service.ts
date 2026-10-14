import { Types, type ClientSession } from 'mongoose';
import type { z } from 'zod';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { resolveWriteBranch, scopedRepo } from '../../core/scope';
import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { formatPhone } from '../../lib/phone';
import { withTransaction } from '../../lib/transaction';
import { Client } from '../clients/client.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { FollowUp } from '../followups/followup.model';
import { Booking } from '../bookings/booking.model';
import { Referral } from '../referrals/referral.model';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import { Seller } from '../sellers/seller.model';
import { Person } from './person.model';
import type { createPersonBody, linkBody, updatePersonBody } from './person.schema';

type PersonLean = { _id: Types.ObjectId; name: string; phone: string; phoneE164: string; email?: string | null; address?: string | null; branchIds?: Types.ObjectId[]; createdAt?: Date; updatedAt?: Date };

/** Identity-only operations that must see every branch go through this single, approved gateway. */
const anyBranch = (detail: string) => systemRepo(Person, 'identity', detail);
const visible = (principal: Principal) => scopedRepo(Person, principal);

/**
 * What a caller may know about a person. Branch ids are limited to the caller's
 * own scope, so a person's relationships in other branches are never disclosed.
 */
export function personView(p: PersonLean, principal: Principal) {
  const mine = principal.dataScope === 'ALL' ? (p.branchIds ?? []) : (p.branchIds ?? []).filter((b) => principal.branchIds.includes(b.toHexString()));
  return { id: p._id.toHexString(), name: p.name, phone: p.phone, phoneE164: p.phoneE164, email: p.email ?? undefined, address: p.address ?? undefined, branchIds: mine.map((b) => b.toHexString()), createdAt: p.createdAt, updatedAt: p.updatedAt };
}

export const isDuplicateKey = (err: unknown): boolean => (err as { code?: number })?.code === 11000;

export type MatchStatus = 'NONE' | 'VISIBLE_MATCH' | 'HIDDEN_MATCH';

export interface MatchResult {
  status: MatchStatus;
  phoneE164: string;
  /** Present only for VISIBLE_MATCH: a person already related to one of the caller's branches. */
  person?: ReturnType<typeof personView>;
  /** Present only for VISIBLE_MATCH: that person's client relationships the caller may see. */
  clients?: { id: string; clientNo: string; branchId: string }[];
  /** HIDDEN_MATCH only: whether the caller may link the person to their branch. No data about the person is returned. */
  canLink?: boolean;
}

/**
 * Duplicate detection / identity lookup.
 *  - VISIBLE_MATCH: the person is related to a branch the caller can see, so the record is shown.
 *  - HIDDEN_MATCH: a person with this number exists but only in branches the caller cannot see. The
 *    answer discloses EXISTENCE ONLY (no name, branch or any detail), because creating a second
 *    person is impossible (unique phone) and the caller must be told why.
 */
export async function findMatch(principal: Principal, phoneE164: string): Promise<MatchResult> {
  const mine = await visible(principal).findOne({ phoneE164 }).lean<PersonLean>();
  if (mine) {
    const clients = await scopedRepo(Client, principal).find({ personId: mine._id }).select('clientNo branchId').lean<{ _id: Types.ObjectId; clientNo: string; branchId: Types.ObjectId }[]>();
    return { status: 'VISIBLE_MATCH', phoneE164, person: personView(mine, principal), clients: clients.map((c) => ({ id: c._id.toHexString(), clientNo: c.clientNo, branchId: c.branchId.toHexString() })) };
  }
  const elsewhere = await anyBranch('phone existence check').exists({ phoneE164 });
  if (elsewhere) return { status: 'HIDDEN_MATCH', phoneE164, canLink: hasPermission(principal, 'persons.link') };
  return { status: 'NONE', phoneE164 };
}

/** The 409 the API returns instead of creating a second person. */
export function personExists(match: MatchResult): AppError {
  const msg = match.status === 'VISIBLE_MATCH'
    ? 'A person with this phone number already exists. Use the existing record.'
    : 'This phone number is already registered with another branch. A manager can link it to your branch.';
  return AppError.conflict('PERSON_EXISTS', msg, match);
}

export async function lookupPhone(principal: Principal, phoneE164: string): Promise<MatchResult> {
  const match = await findMatch(principal, phoneE164);
  if (match.status === 'HIDDEN_MATCH') {
    // Probing numbers across branches is security-relevant: leave a trace (no number is recorded).
    const hidden = await anyBranch('phone existence check').findOne({ phoneE164 }).select('_id').lean<{ _id: Types.ObjectId }>();
    if (hidden) await recordAudit({ entityType: 'person', entityId: hidden._id, action: 'lookup_hidden_match', userId: principal.userId, branchId: principal.branchIds[0] }, { bestEffort: true });
  }
  return match;
}

/** Writes the Person row itself (used inside a transaction by createPerson and createClient). */
export async function insertPerson(principal: Principal, input: { name: string; phone: string; email?: string; address?: string }, branchId: string, session?: ClientSession) {
  const doc = await visible(principal).create(
    { name: input.name, phoneE164: input.phone, phone: formatPhone(input.phone), email: input.email, address: input.address, branchIds: [toObjectId(branchId)], createdBy: toObjectId(principal.userId) },
    { session },
  );
  return doc.toObject() as unknown as PersonLean;
}

/** `POST /persons`: create the identity or report the existing match. Never creates a second person, never merges. */
export async function createPerson(principal: Principal, input: z.infer<typeof createPersonBody>) {
  const branchId = resolveWriteBranch(principal, input.branchId);
  const existing = await findMatch(principal, input.phone);
  if (existing.status !== 'NONE') throw personExists(existing);
  try {
    const person = await withTransaction(async (session) => {
      const p = await insertPerson(principal, input, branchId, session);
      await recordAudit({ entityType: 'person', entityId: p._id, action: 'create', after: { name: p.name, phoneE164: p.phoneE164, email: p.email, address: p.address }, userId: principal.userId, branchId }, { session });
      return p;
    });
    return personView(person, principal);
  } catch (err) {
    // Lost a race with a concurrent creator: the unique index is the real guard.
    if (isDuplicateKey(err)) throw personExists(await findMatch(principal, input.phone));
    throw err;
  }
}

/** Makes sure `personId` has a relationship with `branchId` (used when a branch creates a record for an existing person). */
export async function ensurePersonInBranch(principal: Principal, personId: Types.ObjectId, branchId: string, session?: ClientSession): Promise<void> {
  await visible(principal).updateOne({ _id: personId }, { $addToSet: { branchIds: toObjectId(branchId) } }, { session });
}

/** Rewrites the search projection on clients, enquiries, follow-ups AND site visits in EVERY branch after an identity change. */
async function syncClientProjection(p: PersonLean, session: ClientSession): Promise<void> {
  const $set = { personName: p.name, phoneE164: p.phoneE164 };
  await systemRepo(Client, 'identity', 'client search projection').updateMany({ personId: p._id }, { $set }, { session });
  await systemRepo(Enquiry, 'identity', 'enquiry search projection').updateMany({ personId: p._id }, { $set }, { session });
  await systemRepo(FollowUp, 'identity', 'follow-up search projection').updateMany({ personId: p._id }, { $set }, { session });
  await systemRepo(SiteVisit, 'identity', 'site visit search projection').updateMany({ personId: p._id }, { $set }, { session });
  await systemRepo(Booking, 'identity', 'booking search projection').updateMany({ personId: p._id }, { $set }, { session });
  await systemRepo(Referral, 'identity', 'referral search projection').updateMany({ personId: p._id }, { $set }, { session });
  await systemRepo(Seller, 'identity', 'seller search projection').updateMany({ personId: p._id }, { $set }, { session });
}

/** Identity edit (name, phone, email, address). The phone stays unique; a clash is reported, never merged. */
export async function updatePerson(principal: Principal, id: string, patch: z.infer<typeof updatePersonBody>) {
  const repo = visible(principal);
  const before = await repo.findById(id).lean<PersonLean>();
  if (!before) throw AppError.notFound('Person not found');

  if (patch.phone && patch.phone !== before.phoneE164) {
    const clash = await anyBranch('phone uniqueness').exists({ phoneE164: patch.phone, _id: { $ne: before._id } });
    if (clash) throw AppError.conflict('PHONE_TAKEN', 'Another person already has this phone number');
  }
  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.phone !== undefined) Object.assign(set, { phoneE164: patch.phone, phone: formatPhone(patch.phone) });
  for (const k of ['email', 'address'] as const) if (patch[k] !== undefined) (patch[k] === null ? unset : set)[k] = patch[k] === null ? 1 : patch[k];

  try {
    return await withTransaction(async (session) => {
      const after = await repo.findOneAndUpdate({ _id: before._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session }).lean<PersonLean>();
      if (!after) throw AppError.notFound('Person not found');
      await syncClientProjection(after, session);
      const pick = (p: PersonLean) => ({ name: p.name, phoneE164: p.phoneE164, email: p.email, address: p.address });
      // Identity is shared across branches, so this audit entry is company-wide (no branch).
      await recordAudit({ entityType: 'person', entityId: before._id, action: 'update', before: pick(before), after: pick(after), userId: principal.userId }, { session });
      return personView(after, principal);
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw AppError.conflict('PHONE_TAKEN', 'Another person already has this phone number');
    throw err;
  }
}

/**
 * Explicitly attaches an existing person (found by phone) to the caller's branch so the branch can
 * use the same identity instead of duplicating it. Needs `persons.link`, a reason, and is audited and
 * recorded on the timeline. This is the ONLY way a person becomes visible to a branch it had no
 * relationship with.
 */
export async function linkPerson(principal: Principal, input: z.infer<typeof linkBody>) {
  const branchId = resolveWriteBranch(principal, input.branchId);
  const found = await anyBranch('explicit person link').findOne({ phoneE164: input.phone }).lean<PersonLean>();
  if (!found) throw AppError.notFound('No person with that phone number');
  if ((found.branchIds ?? []).some((b) => b.toHexString() === branchId)) return { linked: false, person: personView(found, principal) };

  const person = await withTransaction(async (session) => {
    const updated = await anyBranch('explicit person link').findOneAndUpdate({ _id: found._id }, { $addToSet: { branchIds: toObjectId(branchId) } }, { new: true, session }).lean<PersonLean>();
    await recordAudit({ entityType: 'person', entityId: found._id, action: 'link', after: { branch: branchId }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'PERSON_LINKED', description: `${found.name} linked to this branch`, branchId, userId: principal.userId, refs: [{ type: 'person', id: found._id }] }, { session });
    return updated!;
  });
  return { linked: true, person: personView(person, principal) };
}

// ---- shared by every record that hangs off a person (clients, enquiries, …) ----------------------

export interface PersonInput {
  /** An existing person the caller can already see: the explicit "use this person" confirmation. */
  personId?: string;
  /** New identity details. If the phone already exists the call fails with PERSON_EXISTS. */
  person?: { name: string; phone: string; email?: string; address?: string };
}
export type PreparedPerson = { existing: PersonLean } | { fresh: NonNullable<PersonInput['person']> };

/**
 * Step 1 (before spending ids or opening a transaction): decide which person a new record will use.
 * `personId` must be visible to the caller (otherwise 404, identical to a non-existent id, so there is
 * no existence oracle); `person` details must not match any existing person (otherwise 409 PERSON_EXISTS).
 */
export async function preparePerson(principal: Principal, input: PersonInput): Promise<PreparedPerson> {
  if (input.personId) {
    const existing = await visible(principal).findById(input.personId).lean<PersonLean>();
    if (!existing) throw AppError.notFound('Person not found');
    return { existing };
  }
  const match = await findMatch(principal, input.person!.phone);
  if (match.status !== 'NONE') throw personExists(match);
  return { fresh: input.person! };
}

/** Step 2 (inside the transaction): create the person or attach the branch to the existing one. */
export async function materializePerson(principal: Principal, prepared: PreparedPerson, branchId: string, session: ClientSession): Promise<PersonLean> {
  if ('existing' in prepared) {
    // Only touch the person when the branch relationship is actually new: reusing someone already related to this branch changes nothing.
    if (!(prepared.existing.branchIds ?? []).some((b) => b.toHexString() === branchId)) await ensurePersonInBranch(principal, prepared.existing._id, branchId, session);
    return prepared.existing;
  }
  return insertPerson(principal, prepared.fresh, branchId, session);
}
