import type { ClientSession } from 'mongoose';
import type { z } from 'zod';
import { recordAudit } from '../../core/audit/audit.service';
import { assertCanGrant } from '../../core/permissions/grants';
import type { Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { withTransaction } from '../../lib/transaction';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { hashPassword, revokeAllForUser } from '../auth/auth.service';
import { Branch } from '../branches/branch.model';
import { Role } from '../roles/role.model';
import { User } from './user.model';
import type { createUserBody, listUserQuery, updateUserBody } from './user.schema';

type UserLean = {
  _id: import('mongoose').Types.ObjectId;
  name: string;
  email: string;
  phone?: string | null;
  roleId: import('mongoose').Types.ObjectId;
  branchIds?: import('mongoose').Types.ObjectId[];
  primaryBranchId?: import('mongoose').Types.ObjectId | null;
  isActive: boolean;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

/** Explicit whitelist: credentials, lockout counters and token versions can never leak. */
function toView(u: UserLean, roleNames: Map<string, string>) {
  return {
    id: u._id.toHexString(),
    name: u.name,
    email: u.email,
    phone: u.phone ?? undefined,
    roleId: u.roleId.toHexString(),
    roleName: roleNames.get(u.roleId.toHexString()),
    branchIds: (u.branchIds ?? []).map((b) => b.toHexString()),
    primaryBranchId: u.primaryBranchId?.toHexString(),
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ?? undefined,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

async function roleNameMap(users: UserLean[]): Promise<Map<string, string>> {
  const ids = [...new Set(users.map((u) => u.roleId.toHexString()))];
  const roles = await Role.find({ _id: { $in: ids } }).select('name').lean();
  return new Map(roles.map((r) => [r._id.toHexString(), r.name]));
}

// Visibility is enforced by the scope layer (User: branchIds + self), never by ad-hoc filters here.
const usersFor = (actor: Principal, requestedBranchId?: string) => scopedRepo(User, actor, { requestedBranchId });
/** Email uniqueness is global: it must see users in every branch (reveals existence only). */
const emailTaken = (email: string, exceptId?: unknown) =>
  systemRepo(User, 'integrity', 'email uniqueness').exists(exceptId ? { email, _id: { $ne: exceptId } } : { email });

export async function listUsers(actor: Principal, q: z.infer<typeof listUserQuery>) {
  const and: Record<string, unknown>[] = [];
  if (q.roleId) and.push({ roleId: toObjectId(q.roleId) });
  if (q.isActive) and.push({ isActive: q.isActive === 'true' });
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    and.push({ $or: [{ name: rx }, { email: rx }, { phone: rx }] });
  }
  const filter = and.length ? { $and: and } : {};
  const repo = usersFor(actor, q.branchId);
  const { skip, limit } = toWindow(q);
  const [rows, total] = await Promise.all([
    repo.find(filter).sort(parseSort(q.sort, ['name', 'email', 'createdAt', 'lastLoginAt'], { name: 1 })).skip(skip).limit(limit).lean<UserLean[]>(),
    repo.countDocuments(filter),
  ]);
  const names = await roleNameMap(rows);
  return { rows: rows.map((u) => toView(u, names)), meta: toMeta(q, total) };
}

export async function getUser(actor: Principal, id: string) {
  const u = await usersFor(actor).findById(id).lean<UserLean>();
  if (!u) throw AppError.notFound('User not found');
  return toView(u, await roleNameMap([u]));
}

async function loadAssignableRole(actor: Principal, roleId: string) {
  const role = await Role.findById(toObjectId(roleId)).lean();
  if (!role || !role.isActive) throw AppError.validation('Invalid role', [{ path: 'roleId', message: 'Role does not exist or is inactive' }]);
  assertCanGrant(actor, role.permissions, role.dataScope);
  return role;
}

/** Branch membership must exist, be active, and never widen the actor's own reach. */
async function validateBranches(actor: Principal, branchIds: string[], role: { dataScope: string }) {
  const unique = [...new Set(branchIds)];
  if (actor.dataScope !== 'ALL') {
    const outside = unique.filter((b) => !actor.branchIds.includes(b));
    if (outside.length) throw AppError.forbidden('You can only assign branches you belong to');
  }
  if (unique.length) {
    const found = await scopedRepo(Branch, actor).countDocuments({ _id: { $in: unique.map((b) => toObjectId(b)) }, isActive: true });
    if (found !== unique.length) throw AppError.validation('Invalid branch', [{ path: 'branchIds', message: 'One or more branches do not exist or are inactive' }]);
  }
  if (role.dataScope !== 'ALL' && unique.length === 0) {
    throw AppError.validation('This role requires at least one branch', [{ path: 'branchIds', message: 'Select at least one branch' }]);
  }
  return unique;
}

function pickPrimary(branchIds: string[], requested?: string | null): string | undefined {
  if (requested) {
    if (!branchIds.includes(requested)) throw AppError.validation('Primary branch must be one of the user\'s branches', [{ path: 'primaryBranchId', message: 'Not in branchIds' }]);
    return requested;
  }
  return branchIds[0];
}

export async function createUser(actor: Principal, input: z.infer<typeof createUserBody>) {
  const role = await loadAssignableRole(actor, input.roleId);
  const branchIds = await validateBranches(actor, input.branchIds, role);
  if (await emailTaken(input.email)) throw AppError.conflict('EMAIL_TAKEN', 'A user with this email already exists');

  const primary = pickPrimary(branchIds, input.primaryBranchId);
  const user = await usersFor(actor).create({
    name: input.name,
    email: input.email,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    roleId: role._id,
    branchIds: branchIds.map((b) => toObjectId(b)),
    primaryBranchId: primary ? toObjectId(primary) : undefined,
    createdBy: toObjectId(actor.userId),
  });
  const view = toView(user.toObject() as UserLean, new Map([[role._id.toHexString(), role.name]]));
  await recordAudit({ entityType: 'user', entityId: user._id, action: 'create', after: { ...view, id: undefined }, userId: actor.userId, branchId: primary });
  return view;
}

export async function updateUser(actor: Principal, id: string, patch: z.infer<typeof updateUserBody>) {
  const repo = usersFor(actor);
  const target = await repo.findById(id).select('+tokenVersion').lean<UserLean & { tokenVersion?: number }>();
  if (!target) throw AppError.notFound('User not found');
  const isSelf = target._id.toHexString() === actor.userId;

  if (isSelf && (patch.roleId !== undefined || patch.isActive !== undefined || patch.branchIds !== undefined)) {
    throw AppError.forbidden('You cannot change your own role, branches or active status');
  }

  // You may not edit someone more powerful than you (e.g. a Manager editing an Admin).
  const currentRole = await Role.findById(target.roleId).lean();
  if (!currentRole) throw AppError.conflict('ROLE_MISSING', 'User has no valid role');
  if (!isSelf) assertCanGrant(actor, currentRole.permissions, currentRole.dataScope);

  const role = patch.roleId && patch.roleId !== target.roleId.toHexString() ? await loadAssignableRole(actor, patch.roleId) : currentRole;

  let finalBranchIds: string[] | undefined;
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.phone !== undefined) (patch.phone === null ? unset : set).phone = patch.phone ?? 1;
  if (patch.email !== undefined && patch.email !== target.email) {
    if (await emailTaken(patch.email, target._id)) throw AppError.conflict('EMAIL_TAKEN', 'A user with this email already exists');
    set.email = patch.email;
  }
  if (patch.roleId !== undefined) set.roleId = role._id;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;

  const currentBranches = (target.branchIds ?? []).map((b) => b.toHexString());
  const roleChanged = patch.roleId !== undefined && patch.roleId !== target.roleId.toHexString();
  if (patch.branchIds !== undefined || roleChanged || patch.primaryBranchId !== undefined) {
    let requested = patch.branchIds ?? currentBranches;
    if (patch.branchIds !== undefined && actor.dataScope !== 'ALL') {
      // Preserve memberships the actor cannot see/manage; they may only change their own part.
      requested = [...new Set([...currentBranches.filter((b) => !actor.branchIds.includes(b)), ...patch.branchIds])];
      const outside = patch.branchIds.filter((b) => !actor.branchIds.includes(b));
      if (outside.length) throw AppError.forbidden('You can only assign branches you belong to');
    }
    const branchIds = await validateBranches(actor.dataScope === 'ALL' ? actor : { ...actor, branchIds: [...actor.branchIds, ...currentBranches] }, requested, role);
    finalBranchIds = branchIds;
    // ALL actors set the list directly; narrower actors go through $addToSet/$pull below so the
    // scope layer can verify every branch they add or remove is inside their own scope.
    if (actor.dataScope === 'ALL') set.branchIds = branchIds.map((b) => toObjectId(b));
    const primary = pickPrimary(branchIds, patch.primaryBranchId === undefined ? (target.primaryBranchId?.toHexString() && branchIds.includes(target.primaryBranchId.toHexString()) ? target.primaryBranchId.toHexString() : undefined) : patch.primaryBranchId);
    if (primary) set.primaryBranchId = toObjectId(primary);
    else unset.primaryBranchId = 1;
  }

  const invalidateSessions = patch.password !== undefined || patch.isActive === false || roleChanged;
  if (patch.password !== undefined) set.passwordHash = await hashPassword(patch.password);
  set.updatedBy = toObjectId(actor.userId);

  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length) update.$unset = unset;
  if (invalidateSessions) update.$inc = { tokenVersion: 1 };
  const delta = finalBranchIds && actor.dataScope !== 'ALL'
    ? {
        add: finalBranchIds.filter((b) => !currentBranches.includes(b)),
        remove: currentBranches.filter((b) => actor.branchIds.includes(b) && !finalBranchIds!.includes(b)),
      }
    : undefined;

  const apply = async (session?: ClientSession) => {
    const updated = await repo.findOneAndUpdate({ _id: target._id }, update, { new: true, session }).select('+passwordHash').lean<UserLean & { passwordHash?: string }>();
    if (!updated) throw AppError.notFound('User not found');
    // Add first, then remove: removing the last shared branch takes the user out of the actor's
    // scope, after which further writes (correctly) would no longer match.
    if (delta?.add.length) await repo.updateOne({ _id: target._id }, { $addToSet: { branchIds: { $each: delta.add.map((b) => toObjectId(b)) } } }, { session });
    if (delta?.remove.length) await repo.updateOne({ _id: target._id }, { $pull: { branchIds: { $in: delta.remove.map((b) => toObjectId(b)) } } }, { session });
    if (finalBranchIds && delta) updated.branchIds = finalBranchIds.map((b) => toObjectId(b));
    return updated;
  };
  // Several writes must land together; a single write needs no transaction.
  const after = delta && (delta.add.length || delta.remove.length) ? await withTransaction((session) => apply(session)) : await apply();
  if (invalidateSessions) await revokeAllForUser(target._id);

  const action = patch.isActive === false ? 'deactivate' : patch.isActive === true && !target.isActive ? 'activate' : roleChanged ? 'role_changed' : patch.password !== undefined ? 'password_reset' : 'update';
  const strip = (u: UserLean & { passwordHash?: string; tokenVersion?: number }) => ({ name: u.name, email: u.email, phone: u.phone, roleId: u.roleId, branchIds: u.branchIds, primaryBranchId: u.primaryBranchId, isActive: u.isActive, passwordHash: u.passwordHash });
  await recordAudit({
    entityType: 'user',
    entityId: target._id,
    action,
    before: strip({ ...target, passwordHash: patch.password !== undefined ? 'previous' : undefined }),
    after: strip(after),
    userId: actor.userId,
    branchId: after.primaryBranchId ?? undefined,
  });
  return toView(after, await roleNameMap([after]));
}
