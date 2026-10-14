import type { z } from 'zod';
import { recordAudit } from '../../core/audit/audit.service';
import type { Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { Branch } from './branch.model';
import type { createBranchBody, listBranchQuery, updateBranchBody } from './branch.schema';

// Visibility (ALL / own branches) is enforced by the scope layer: Branch is scoped on `_id`.
const repo = (principal: Principal) => scopedRepo(Branch, principal);

export async function listBranches(principal: Principal, q: z.infer<typeof listBranchQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.isActive) filter.isActive = q.isActive === 'true';
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { code: rx }];
  }
  const { skip, limit } = toWindow(q);
  const [rows, total] = await Promise.all([
    repo(principal).find(filter).sort(parseSort(q.sort, ['name', 'code', 'createdAt'], { name: 1 })).skip(skip).limit(limit).lean(),
    repo(principal).countDocuments(filter),
  ]);
  return { rows, meta: toMeta(q, total) };
}

export async function getBranch(principal: Principal, id: string) {
  const branch = await repo(principal).findById(id).lean();
  if (!branch) throw AppError.notFound('Branch not found');
  return branch;
}

export async function createBranch(principal: Principal, input: z.infer<typeof createBranchBody>) {
  const code = input.code.toUpperCase();
  if (await systemRepo(Branch, 'integrity', 'branch code uniqueness').exists({ code })) throw AppError.conflict('BRANCH_CODE_TAKEN', 'A branch with this code already exists');
  const branch = await repo(principal).create({ ...input, code });
  await recordAudit({ entityType: 'branch', entityId: branch._id, action: 'create', after: branch.toObject(), userId: principal.userId, branchId: branch._id });
  return branch.toObject();
}

export async function updateBranch(principal: Principal, id: string, patch: z.infer<typeof updateBranchBody>) {
  const before = await repo(principal).findById(id).lean();
  if (!before) throw AppError.notFound('Branch not found');
  if (patch.code && patch.code.toUpperCase() !== before.code && (await systemRepo(Branch, 'integrity', 'branch code uniqueness').exists({ code: patch.code.toUpperCase(), _id: { $ne: before._id } }))) {
    throw AppError.conflict('BRANCH_CODE_TAKEN', 'A branch with this code already exists');
  }
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) unset[k] = 1;
    else set[k] = k === 'code' ? String(v).toUpperCase() : v;
  }
  const after = await repo(principal).findOneAndUpdate({ _id: before._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true }).lean();
  await recordAudit({ entityType: 'branch', entityId: before._id, action: patch.isActive === false ? 'deactivate' : 'update', before, after: after ?? undefined, userId: principal.userId, branchId: before._id });
  return after;
}
