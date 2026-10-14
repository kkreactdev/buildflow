import type { Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { User } from './user.model';

/**
 * Who may own a record in `branchId`: an ACTIVE user of that branch whom the actor can see.
 * Users with OWN scope can only assign to themselves, so they cannot hand work to others or
 * assign something out of their own reach.
 */
export async function validateAssignee(principal: Principal, userId: string, branchId: string): Promise<void> {
  if (principal.dataScope === 'OWN' && userId !== principal.userId) throw AppError.forbidden('You can only assign to yourself');
  const ok = await scopedRepo(User, principal).exists({ _id: toObjectId(userId), isActive: true, branchIds: toObjectId(branchId) });
  if (!ok) throw AppError.validation('Invalid assignee', [{ path: 'assignedTo', message: 'Choose an active user of this branch' }]);
}
