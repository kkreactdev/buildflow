import type { Types } from 'mongoose';
import type { z } from 'zod';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { formatSequence, nextSequence } from '../../core/counters/counter.service';
import type { Principal } from '../../core/permissions/principal';
import { resolveWriteBranch, scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { formatPhone, phoneSearchDigits } from '../../lib/phone';
import { withTransaction } from '../../lib/transaction';
import { Branch } from '../branches/branch.model';
import { assertActiveMaster, masterLabels } from '../masters/master.service';
import { Person } from '../persons/person.model';
import { findMatch, isDuplicateKey, materializePerson, personExists, personView, preparePerson } from '../persons/person.service';
import { User } from '../users/user.model';
import { validateAssignee } from '../users/assignable';
import { Enquiry } from '../enquiries/enquiry.model';
import { compact, unitRelations } from '../unitInterests/unitRelations';
import { Client } from './client.model';
import './client.references';
import type { createClientBody, listClientQuery, updateClientBody } from './client.schema';

const CLIENT_NO = { prefix: 'CL-', width: 6 } as const;
export const nextClientNo = async (): Promise<string> => formatSequence(await nextSequence('client'), CLIENT_NO);

type Lean = {
  _id: Types.ObjectId; clientNo: string; personId: Types.ObjectId; branchId: Types.ObjectId; personName: string; phoneE164: string;
  categoryId?: Types.ObjectId | null; assignedTo?: Types.ObjectId | null; notes?: string | null; isArchived?: boolean; archivedAt?: Date | null;
  createdAt?: Date; updatedAt?: Date;
};

const repo = (principal: Principal, requestedBranchId?: string, includeArchived = false) => scopedRepo(Client, principal, { requestedBranchId, includeArchived });

/** Display data for categories (INCLUDING inactive ones, so history keeps its meaning), assignees and branches. */
async function lookups(principal: Principal, rows: Lean[]) {
  const catIds = rows.map((r) => r.categoryId).filter(Boolean) as Types.ObjectId[];
  const userIds = rows.map((r) => r.assignedTo).filter(Boolean) as Types.ObjectId[];
  const branchIds = [...new Set(rows.map((r) => r.branchId.toHexString()))];
  const [cats, users, branches] = await Promise.all([
    catIds.length ? masterLabels(principal, catIds) : new Map(),
    userIds.length ? scopedRepo(User, principal).find({ _id: { $in: userIds } }).select('name').lean<{ _id: Types.ObjectId; name: string }[]>() : [],
    scopedRepo(Branch, principal).find({ _id: { $in: branchIds.map((b) => toObjectId(b)) } }).select('name code').lean<{ _id: Types.ObjectId; name: string; code: string }[]>(),
  ]);
  return {
    cats,
    users: new Map(users.map((u) => [u._id.toHexString(), u.name])),
    branches: new Map(branches.map((b) => [b._id.toHexString(), { name: b.name, code: b.code }])),
  };
}

function toView(c: Lean, l: Awaited<ReturnType<typeof lookups>>) {
  const category = c.categoryId ? l.cats.get(c.categoryId.toHexString()) : undefined;
  return {
    id: c._id.toHexString(),
    clientNo: c.clientNo,
    personId: c.personId.toHexString(),
    name: c.personName,
    phone: formatPhone(c.phoneE164),
    phoneE164: c.phoneE164,
    branchId: c.branchId.toHexString(),
    branch: l.branches.get(c.branchId.toHexString()),
    categoryId: c.categoryId?.toHexString(),
    /** Includes inactive categories: existing clients keep displaying the category they have. */
    category,
    assignedTo: c.assignedTo?.toHexString(),
    assignedToName: c.assignedTo ? l.users.get(c.assignedTo.toHexString()) : undefined,
    notes: c.notes ?? undefined,
    isArchived: Boolean(c.isArchived),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function listClients(principal: Principal, q: z.infer<typeof listClientQuery>) {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  if (q.categoryId) and.push({ categoryId: toObjectId(q.categoryId) });
  if (q.assignedTo) and.push({ assignedTo: toObjectId(q.assignedTo) });

  // Search runs over fields stored on the (branch-scoped) client, so it can only ever match clients the caller may see.
  const term = q.search?.trim();
  if (term) {
    const ors: Record<string, unknown>[] = [{ personName: new RegExp(escapeRegex(term), 'i') }, { clientNo: new RegExp(`^${escapeRegex(term)}`, 'i') }];
    const digits = phoneSearchDigits(term);
    if (digits) ors.push({ phoneE164: new RegExp(escapeRegex(digits)) });
    and.push({ $or: ors });
  }
  const filter = { $and: and };
  const r = repo(principal, q.branchId, true);
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['createdAt', 'personName', 'clientNo'], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    r.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<Lean[]>(),
    r.countDocuments(filter),
  ]);
  const l = await lookups(principal, rows);
  const views = rows.map((c) => toView(c, l));
  // One Units column: each client's units across ALL of its enquiries (resolved by person + branch), through the shared engine.
  const idScope: Principal = principal.dataScope === 'OWN' ? { ...principal, dataScope: 'BRANCH', branchIds: [...new Set(rows.map((c) => c.branchId.toHexString()))] } : principal;
  const enquiries = rows.length ? await scopedRepo(Enquiry, idScope, { includeArchived: true }).find({ $or: rows.map((c) => ({ personId: c.personId, branchId: c.branchId })) }).select('personId branchId').lean<{ _id: Types.ObjectId; personId: Types.ObjectId; branchId: Types.ObjectId }[]>() : [];
  const relations = await unitRelations(principal, rows.map((c) => ({ key: c._id.toHexString(), enquiryIds: enquiries.filter((e) => e.personId.equals(c.personId) && e.branchId.equals(c.branchId)).map((e) => e._id) })));
  return { rows: relations ? views.map((v) => ({ ...v, units: compact(relations.get(v.id) ?? []) })) : views, meta: toMeta(q, total) };
}

export async function getClient(principal: Principal, id: string) {
  const c = await repo(principal, undefined, true).findById(id).lean<Lean>();
  if (!c) throw AppError.notFound('Client not found');
  // The person is authoritative for identity; other relationships are only those the caller's scope allows.
  const [person, siblings] = await Promise.all([
    scopedRepo(Person, principal).findById(c.personId.toHexString()).lean(),
    repo(principal).find({ personId: c.personId, _id: { $ne: c._id } }).lean<Lean[]>(),
  ]);
  const l = await lookups(principal, [c, ...siblings]);
  return {
    ...toView(c, l),
    person: person ? personView(person as never, principal) : undefined,
    relationships: siblings.map((s) => ({ id: s._id.toHexString(), clientNo: s.clientNo, branchId: s.branchId.toHexString(), branch: l.branches.get(s.branchId.toHexString()) })),
  };
}

export async function createClient(principal: Principal, input: z.infer<typeof createClientBody>) {
  const branchId = resolveWriteBranch(principal, input.branchId);
  if (input.categoryId) await assertActiveMaster(principal, 'CLIENT_CATEGORY', input.categoryId, 'categoryId');
  const assignedTo = input.assignedTo ?? (principal.dataScope === 'OWN' ? principal.userId : undefined);
  if (assignedTo) await validateAssignee(principal, assignedTo, branchId);

  // Resolve identity BEFORE spending a client number (existing person must be visible; a phone match is reported, never merged).
  const prepared = await preparePerson(principal, input);

  const clientNo = await nextClientNo(); // unique and atomic; a failed create below only leaves a gap

  try {
    const created = await withTransaction(async (session) => {
      const person = await materializePerson(principal, prepared, branchId, session);

      const dup = await repo(principal).findOne({ personId: person._id, branchId: toObjectId(branchId) }).session(session).select('clientNo').lean<{ _id: Types.ObjectId; clientNo: string }>();
      if (dup) throw AppError.conflict('CLIENT_EXISTS', `This person is already a client of this branch (${dup.clientNo})`, { clientId: dup._id.toHexString(), clientNo: dup.clientNo });

      const doc = await repo(principal).create(
        {
          clientNo, personId: person._id, branchId: toObjectId(branchId), personName: person.name, phoneE164: person.phoneE164,
          categoryId: input.categoryId ? toObjectId(input.categoryId) : undefined,
          assignedTo: assignedTo ? toObjectId(assignedTo) : undefined,
          notes: input.notes, createdBy: toObjectId(principal.userId),
        },
        { session },
      );
      const lean = doc.toObject() as unknown as Lean;
      await recordAudit({ entityType: 'client', entityId: doc._id, action: 'create', after: { clientNo, personId: person._id, categoryId: lean.categoryId, assignedTo: lean.assignedTo, notes: lean.notes }, userId: principal.userId, branchId }, { session });
      await recordActivity({ type: 'CLIENT_CREATED', description: `Client ${person.name} (${clientNo}) created`, branchId, userId: principal.userId, refs: [{ type: 'client', id: doc._id }, { type: 'person', id: person._id }] }, { session });
      return lean;
    });
    return toView(created, await lookups(principal, [created]));
  } catch (err) {
    // A concurrent creator won the unique index: report the same way as a pre-checked duplicate.
    if (isDuplicateKey(err) && input.person) throw personExists(await findMatch(principal, input.person.phone));
    if (isDuplicateKey(err)) throw AppError.conflict('CLIENT_EXISTS', 'This person is already a client of this branch');
    throw err;
  }
}

export async function updateClient(principal: Principal, id: string, patch: z.infer<typeof updateClientBody>) {
  const r = repo(principal);
  const before = await r.findById(id).lean<Lean>();
  if (!before) throw AppError.notFound('Client not found');

  const categoryChanged = patch.categoryId !== undefined && (patch.categoryId ?? undefined) !== before.categoryId?.toHexString();
  // Only a NEW category must be active; an unchanged (possibly since-deactivated) one stays valid.
  if (categoryChanged && patch.categoryId) await assertActiveMaster(principal, 'CLIENT_CATEGORY', patch.categoryId, 'categoryId');
  const assigneeChanged = patch.assignedTo !== undefined && (patch.assignedTo ?? undefined) !== before.assignedTo?.toHexString();
  if (assigneeChanged && patch.assignedTo) await validateAssignee(principal, patch.assignedTo, before.branchId.toHexString());

  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) unset[k] = 1;
    else set[k] = k === 'categoryId' || k === 'assignedTo' ? toObjectId(v as string) : v;
  }
  const branchId = before.branchId.toHexString();

  const after = await withTransaction(async (session) => {
    const updated = await r.findOneAndUpdate({ _id: before._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session }).lean<Lean>();
    if (!updated) throw AppError.notFound('Client not found');
    const pick = (c: Lean) => ({ categoryId: c.categoryId, assignedTo: c.assignedTo, notes: c.notes });
    await recordAudit({ entityType: 'client', entityId: before._id, action: categoryChanged ? 'category_changed' : 'update', before: pick(before), after: pick(updated), userId: principal.userId, branchId }, { session });
    if (categoryChanged || assigneeChanged) {
      await recordActivity({ type: 'CLIENT_UPDATED', description: `${before.personName} (${before.clientNo}) ${categoryChanged ? 'category changed' : 'reassigned'}`, branchId, userId: principal.userId, refs: [{ type: 'client', id: before._id }, { type: 'person', id: before.personId }] }, { session });
    }
    return updated;
  });
  return toView(after, await lookups(principal, [after]));
}

/** Soft delete. The relationship disappears from lists (and a new one may be created later), but its history stays. */
export async function archiveClient(principal: Principal, id: string) {
  const r = repo(principal);
  const c = await r.findById(id).lean<Lean>();
  if (!c) throw AppError.notFound('Client not found');
  const branchId = c.branchId.toHexString();
  await withTransaction(async (session) => {
    if (!(await r.archiveOne({ _id: c._id }, principal.userId, { session }))) throw AppError.notFound('Client not found');
    await recordAudit({ entityType: 'client', entityId: c._id, action: 'archive', before: { isArchived: false }, after: { isArchived: true }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'CLIENT_ARCHIVED', description: `Client ${c.personName} (${c.clientNo}) archived`, branchId, userId: principal.userId, refs: [{ type: 'client', id: c._id }, { type: 'person', id: c.personId }] }, { session });
  });
}
