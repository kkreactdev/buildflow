import type { Types } from 'mongoose';
import type { Principal } from '../../core/permissions/principal';

interface RoleLike {
  permissions: string[];
  dataScope: 'ALL' | 'BRANCH' | 'OWN';
}
interface UserLike {
  _id: Types.ObjectId;
  branchIds?: Types.ObjectId[];
}

/**
 * Builds the request principal from DATABASE state (user + role). Nothing the
 * client sends (body, query, headers) feeds into permissions, scope or branches.
 */
export function buildPrincipal(user: UserLike, role: RoleLike): Principal {
  return {
    userId: user._id.toHexString(),
    permissions: new Set(role.permissions),
    dataScope: role.dataScope,
    branchIds: (user.branchIds ?? []).map((b) => b.toHexString()),
  };
}

export interface SessionView {
  user: { id: string; name: string; email: string; phone?: string; roleId: string; roleName: string; primaryBranchId?: string };
  permissions: string[];
  dataScope: Principal['dataScope'];
  branchIds: string[];
}

export function toSessionView(
  user: { _id: Types.ObjectId; name: string; email: string; phone?: string | null; primaryBranchId?: Types.ObjectId | null; branchIds?: Types.ObjectId[] },
  role: { _id: Types.ObjectId; name: string; permissions: string[]; dataScope: Principal['dataScope'] },
): SessionView {
  return {
    user: {
      id: user._id.toHexString(),
      name: user.name,
      email: user.email,
      ...(user.phone ? { phone: user.phone } : {}),
      roleId: role._id.toHexString(),
      roleName: role.name, // display only
      ...(user.primaryBranchId ? { primaryBranchId: user.primaryBranchId.toHexString() } : {}),
    },
    permissions: [...role.permissions],
    dataScope: role.dataScope,
    branchIds: (user.branchIds ?? []).map((b) => b.toHexString()),
  };
}
