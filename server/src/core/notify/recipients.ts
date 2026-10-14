import type { Types } from 'mongoose';
import { systemRepo } from '../scope/system';
import { Role } from '../../modules/roles/role.model';
import { User } from '../../modules/users/user.model';
import type { RecipientRule } from './events';
import { WILDCARD } from '../permissions/catalog';

export interface RecipientContext {
  branchId: string;
  /** Named users the rules can refer to, e.g. `{ assignee: '<userId>' }`. */
  subjects: Record<string, string | undefined>;
}

/** Ids of users (deduplicated) who should receive an event. Only ACTIVE users are ever returned. */
export async function resolveRecipients(rules: readonly RecipientRule[], ctx: RecipientContext): Promise<string[]> {
  const ids = new Set<string>();
  const users = systemRepo(User, 'notify', 'notification recipients');

  for (const rule of rules) {
    if (rule.kind === 'subject') {
      const id = ctx.subjects[rule.name];
      if (!id) continue;
      if (await users.exists({ _id: id, isActive: true })) ids.add(id);
    } else {
      const roles = await Role.find({ isActive: true, permissions: { $in: [rule.permission, WILDCARD] } }).select('_id').lean<{ _id: Types.ObjectId }[]>();
      if (roles.length === 0) continue;
      const members = await users.find({ roleId: { $in: roles.map((r) => r._id) }, branchIds: ctx.branchId, isActive: true }).select('_id').lean<{ _id: Types.ObjectId }[]>();
      for (const m of members) ids.add(m._id.toHexString());
    }
  }
  return [...ids];
}
