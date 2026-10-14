import type { z } from 'zod';
import { recordAudit } from '../../core/audit/audit.service';
import { systemRepo } from '../../core/scope/system';
import { assertCanGrant } from '../../core/permissions/grants';
import type { Principal } from '../../core/permissions/principal';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { User } from '../users/user.model';
import { Role } from './role.model';
import type { createRoleBody, listRoleQuery, updateRoleBody } from './role.schema';

/** "Is this role still assigned?" must see users in every branch, whatever the actor's scope. */
const usersGlobal = () => systemRepo(User, 'integrity', 'role-in-use check');

export async function listRoles(q: z.infer<typeof listRoleQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.search) filter.name = new RegExp(escapeRegex(q.search), 'i');
  const { skip, limit } = toWindow(q);
  const [rows, total] = await Promise.all([
    Role.find(filter).sort(parseSort(q.sort, ['name', 'createdAt'], { name: 1 })).skip(skip).limit(limit).lean(),
    Role.countDocuments(filter),
  ]);
  return { rows, meta: toMeta(q, total) };
}

export async function getRole(id: string) {
  const role = await Role.findById(toObjectId(id)).lean();
  if (!role) throw AppError.notFound('Role not found');
  return role;
}

export async function createRole(actor: Principal, input: z.infer<typeof createRoleBody>) {
  assertCanGrant(actor, input.permissions, input.dataScope);
  if (await Role.exists({ name: new RegExp(`^${escapeRegex(input.name)}$`, 'i') })) {
    throw AppError.conflict('ROLE_NAME_TAKEN', 'A role with this name already exists');
  }
  const key = input.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (await Role.exists({ key })) throw AppError.conflict('ROLE_NAME_TAKEN', 'A role with this name already exists');
  const role = await Role.create({ ...input, key, isSystem: false });
  await recordAudit({ entityType: 'role', entityId: role._id, action: 'create', after: role.toObject(), userId: actor.userId });
  return role.toObject();
}

export async function updateRole(actor: Principal, id: string, patch: z.infer<typeof updateRoleBody>) {
  const before = await Role.findById(toObjectId(id)).lean();
  if (!before) throw AppError.notFound('Role not found');

  // The Super Admin role is the root of trust: its grants and scope are fixed.
  if (before.permissions.includes('*')) {
    if (patch.permissions || patch.dataScope || patch.isActive === false) {
      throw AppError.forbidden('The Super Admin role cannot be modified');
    }
  }
  // Editing a role you could not hold yourself (e.g. a Manager editing Admin) is escalation too.
  assertCanGrant(actor, before.permissions, before.dataScope);
  assertCanGrant(actor, patch.permissions ?? before.permissions, patch.dataScope ?? before.dataScope);

  if (patch.name && patch.name.toLowerCase() !== before.name.toLowerCase() && (await Role.exists({ name: new RegExp(`^${escapeRegex(patch.name)}$`, 'i'), _id: { $ne: before._id } }))) {
    throw AppError.conflict('ROLE_NAME_TAKEN', 'A role with this name already exists');
  }
  if (patch.isActive === false && (await usersGlobal().exists({ roleId: before._id, isActive: true }))) {
    throw AppError.conflict('ROLE_IN_USE', 'Reassign the active users of this role before deactivating it');
  }

  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(patch)) (v === null ? unset : set)[k] = v === null ? 1 : v;
  const after = await Role.findByIdAndUpdate(before._id, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true }).lean();

  const permsChanged = patch.permissions !== undefined || patch.dataScope !== undefined;
  await recordAudit({
    entityType: 'role',
    entityId: before._id,
    action: permsChanged ? 'permissions_changed' : 'update',
    before,
    after: after ?? undefined,
    userId: actor.userId,
  });
  return after;
}

export async function deleteRole(actor: Principal, id: string) {
  const role = await Role.findById(toObjectId(id)).lean();
  if (!role) throw AppError.notFound('Role not found');
  if (role.isSystem) throw AppError.forbidden('System roles cannot be deleted');
  assertCanGrant(actor, role.permissions, role.dataScope);
  if (await usersGlobal().exists({ roleId: role._id })) throw AppError.conflict('ROLE_IN_USE', 'This role is assigned to users');
  await Role.deleteOne({ _id: role._id });
  await recordAudit({ entityType: 'role', entityId: role._id, action: 'delete', before: role, userId: actor.userId });
}
