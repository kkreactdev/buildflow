import { Types } from 'mongoose';
import type { z } from 'zod';
import { recordAudit } from '../../core/audit/audit.service';
import { assertPermission, type Principal } from '../../core/permissions/principal';
import { resolveWriteBranch, scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { withTransaction } from '../../lib/transaction';
import { Master } from './master.model';
import type { createMasterBody, groupedQuery, listMasterQuery, reorderBody, updateMasterBody } from './master.schema';
import { getMasterType, MASTER_TYPES, type MasterTypeDef } from './masterTypes';
import { hasReferenceCheckers, isMasterReferenced } from './references';

const repo = (principal: Principal, requestedBranchId?: string) => scopedRepo(Master, principal, { requestedBranchId });

export function typeDef(type: string): MasterTypeDef {
  const def = getMasterType(type);
  if (!def) throw AppError.validation('Unknown master type', [{ path: 'type', message: type }]);
  return def;
}

/** Type-specific manage permission (e.g. WhatsApp masters need `whatsapp_masters.manage`). */
export function assertCanManage(principal: Principal | undefined, def: MasterTypeDef): asserts principal is Principal {
  assertPermission(principal, def.managePermission);
  // Global lists belong to the whole company, so only ALL-scope actors may change them.
  if (def.scope === 'GLOBAL' && principal.dataScope !== 'ALL') {
    throw AppError.forbidden(`${def.label} are company-wide and can only be changed by users with access to all branches`);
  }
}

const slug = (label: string): string => label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'V_$1').slice(0, 40);

type Lean = { _id: Types.ObjectId; type: string; code: string; label: string; branchId?: Types.ObjectId | null; sortOrder: number; isActive: boolean; systemKey?: string | null; description?: string | null; color?: string | null; meta?: unknown };

const auditView = (m: Lean) => ({ label: m.label, description: m.description, color: m.color, isActive: m.isActive, sortOrder: m.sortOrder, meta: m.meta });
const branchOf = (m: Lean) => m.branchId ?? undefined;

export const listTypes = () => MASTER_TYPES;

export async function listMasters(principal: Principal, type: string, q: z.infer<typeof listMasterQuery>) {
  typeDef(type);
  const filter: Record<string, unknown> = { type };
  if (q.isActive) filter.isActive = q.isActive === 'true';
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ label: rx }, { code: rx }];
  }
  const r = repo(principal, q.branchId);
  const { skip, limit } = toWindow(q);
  const [rows, total] = await Promise.all([
    r.find(filter).sort(parseSort(q.sort, ['sortOrder', 'label', 'code', 'createdAt'], { sortOrder: 1, label: 1 })).skip(skip).limit(limit).lean(),
    r.countDocuments(filter),
  ]);
  return { rows, meta: toMeta(q, total) };
}

/** Dropdown loader: several types at once, grouped, active-only by default. */
export async function groupedMasters(principal: Principal, q: z.infer<typeof groupedQuery>) {
  const filter: Record<string, unknown> = { type: { $in: q.types } };
  if (q.activeOnly) filter.isActive = true;
  const rows = await repo(principal, q.branchId).find(filter).sort({ sortOrder: 1, label: 1 }).lean();
  const out: Record<string, typeof rows> = Object.fromEntries(q.types.map((t) => [t, []]));
  for (const r of rows) out[r.type]!.push(r);
  return out;
}

export async function getMaster(principal: Principal, type: string, id: string) {
  typeDef(type);
  const m = await repo(principal).findOne({ _id: toObjectId(id), type }).lean();
  if (!m) throw AppError.notFound('Master value not found');
  return m;
}

export async function createMaster(principal: Principal, type: string, input: z.infer<typeof createMasterBody>) {
  const def = typeDef(type);
  assertCanManage(principal, def);

  let branchId: string | undefined;
  if (def.scope === 'BRANCH') branchId = resolveWriteBranch(principal, input.branchId);
  else if (input.branchId) throw AppError.validation(`${def.label} are global and cannot belong to a branch`, [{ path: 'branchId', message: 'Not allowed for global types' }]);

  const code = input.code ?? slug(input.label);
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) throw AppError.validation('Could not derive a valid code from the label; provide one', [{ path: 'code', message: 'Provide a code' }]);

  const r = repo(principal);
  const scopeKey = { type, ...(branchId ? { branchId: toObjectId(branchId) } : { branchId: null }) };
  const dup = await r.exists({ ...scopeKey, code });
  if (dup) throw AppError.conflict('MASTER_CODE_TAKEN', `A ${def.label.replace(/s$/, '')} with code ${code} already exists`);

  const [last] = await r.find(scopeKey).sort({ sortOrder: -1 }).limit(1).lean();
  try {
    const doc = await r.create({
      type,
      code,
      label: input.label,
      description: input.description,
      color: def.hasColor ? input.color : undefined,
      meta: input.meta,
      isActive: input.isActive ?? true,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      branchId: branchId ? toObjectId(branchId) : undefined,
      createdBy: toObjectId(principal.userId),
    });
    const lean = doc.toObject() as Lean;
    await recordAudit({ entityType: 'master', entityId: doc._id, action: 'create', after: { type, code, ...auditView(lean) }, userId: principal.userId, branchId: branchOf(lean) });
    return lean;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw AppError.conflict('MASTER_CODE_TAKEN', 'A value with this code already exists');
    throw err;
  }
}

export async function updateMaster(principal: Principal, type: string, id: string, patch: z.infer<typeof updateMasterBody>) {
  const def = typeDef(type);
  assertCanManage(principal, def);
  const r = repo(principal);
  const before = await r.findOne({ _id: toObjectId(id), type }).lean<Lean>();
  if (!before) throw AppError.notFound('Master value not found');

  if (patch.isActive === false) {
    if (!def.disableable) throw AppError.conflict('NOT_DISABLEABLE', `${def.label} cannot be deactivated`);
    if (before.systemKey) throw AppError.conflict('SYSTEM_VALUE', `${before.label} is required by the system and cannot be deactivated; rename or recolour it instead`);
  }

  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'color' && !def.hasColor) continue;
    if (v === null) unset[k] = 1;
    else set[k] = v;
  }
  const after = await r.findOneAndUpdate({ _id: before._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true }).lean<Lean>();
  if (!after) throw AppError.notFound('Master value not found');

  const action = patch.isActive === false && before.isActive ? 'deactivate' : patch.isActive === true && !before.isActive ? 'activate' : 'update';
  await recordAudit({ entityType: 'master', entityId: before._id, action, before: { type, code: before.code, ...auditView(before) }, after: { type, code: after.code, ...auditView(after) }, userId: principal.userId, branchId: branchOf(after) });
  return after;
}

/**
 * Reorders the COMPLETE list of one type (and branch, for branch-scoped types).
 * The submitted ids must be exactly the current set, so a stale screen cannot
 * silently drop or duplicate values.
 */
export async function reorderMasters(principal: Principal, type: string, input: z.infer<typeof reorderBody>) {
  const def = typeDef(type);
  assertCanManage(principal, def);
  if (!def.reorderable) throw AppError.conflict('NOT_REORDERABLE', `${def.label} cannot be reordered`);

  const branchId = def.scope === 'BRANCH' ? resolveWriteBranch(principal, input.branchId) : undefined;
  if (def.scope === 'GLOBAL' && input.branchId) throw AppError.validation('Global types have no branch', [{ path: 'branchId', message: 'Not allowed' }]);

  const r = repo(principal);
  const group = { type, branchId: branchId ? toObjectId(branchId) : null };
  const current = await r.find(group).sort({ sortOrder: 1, label: 1 }).lean<Lean[]>();
  const currentIds = current.map((m) => m._id.toHexString());
  if (currentIds.length !== input.ids.length || !input.ids.every((i) => currentIds.includes(i))) {
    throw AppError.conflict('REORDER_MISMATCH', 'The list changed since you loaded it. Refresh and try again.');
  }

  const before = new Map(current.map((m) => [m._id.toHexString(), m.sortOrder]));
  const changes = input.ids.map((id, i) => ({ id, from: before.get(id)!, to: i + 1 })).filter((c) => c.from !== c.to);
  if (changes.length === 0) return { changed: 0 };

  await withTransaction(async (session) => {
    await r.bulkWrite(changes.map((c) => ({ updateOne: { filter: { _id: toObjectId(c.id) }, update: { $set: { sortOrder: c.to, updatedBy: toObjectId(principal.userId) } } } })), { session });
    for (const c of changes) {
      await recordAudit({ entityType: 'master', entityId: toObjectId(c.id), action: 'reorder', before: { sortOrder: c.from }, after: { sortOrder: c.to }, userId: principal.userId, branchId }, { session });
    }
  });
  return { changed: changes.length };
}

export async function deleteMaster(principal: Principal, type: string, id: string) {
  const def = typeDef(type);
  assertCanManage(principal, def);
  const r = repo(principal);
  const m = await r.findOne({ _id: toObjectId(id), type }).lean<Lean>();
  if (!m) throw AppError.notFound('Master value not found');

  const deactivate = 'Deactivate it instead: historical records keep showing it.';
  if (!def.deletable) throw AppError.conflict('NOT_DELETABLE', `${def.label} cannot be deleted. ${deactivate}`);
  if (m.systemKey) throw AppError.conflict('SYSTEM_VALUE', `${m.label} is required by the system and cannot be deleted.`);
  if (!hasReferenceCheckers(type)) throw AppError.conflict('DELETE_UNSUPPORTED', `Cannot verify that ${m.label} is unused. ${deactivate}`);
  if (await isMasterReferenced(type, m._id)) throw AppError.conflict('IN_USE', `${m.label} is used by existing records. ${deactivate}`);

  const res = await r.deleteOne({ _id: m._id });
  if (res.deletedCount !== 1) throw AppError.notFound('Master value not found');
  await recordAudit({ entityType: 'master', entityId: m._id, action: 'delete', before: { type, code: m.code, ...auditView(m) }, userId: principal.userId, branchId: branchOf(m) });
}

// ---- helpers for business modules (Enquiries, Units, …) ---------------------

/**
 * Validates a master value chosen for a NEW or CHANGED record: it must exist,
 * be of the expected type, be ACTIVE, and be visible to the actor (their branch
 * or global). Inactive values are rejected here but remain valid on existing
 * records (see `masterLabels`).
 */
export async function assertActiveMaster(principal: Principal, type: string, id: string | Types.ObjectId, field = type.toLowerCase()) {
  const bad = () => AppError.validation(`Invalid ${typeDef(type).label.replace(/s$/, '').toLowerCase()}`, [{ path: field, message: 'Choose an available option' }]);
  const oid = typeof id === 'string' ? (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null) : id;
  if (!oid) throw bad();
  const m = await repo(principal).findOne({ _id: oid, type, isActive: true }).lean<Lean>();
  if (!m) throw bad();
  return m;
}

/** Resolves ids to display data INCLUDING inactive values, so historical records keep their meaning. */
export async function masterLabels(principal: Principal, ids: (string | Types.ObjectId)[]) {
  const oids = ids.filter((i) => Types.ObjectId.isValid(String(i))).map((i) => new Types.ObjectId(String(i)));
  const rows = await repo(principal).find({ _id: { $in: oids } }).lean<Lean[]>();
  return new Map(rows.map((r) => [r._id.toHexString(), { id: r._id.toHexString(), type: r.type, code: r.code, label: r.label, color: r.color ?? undefined, isActive: r.isActive }]));
}

