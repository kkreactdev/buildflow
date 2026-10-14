import type { z } from 'zod';
import { Activity } from '../../core/activity/activity.model';
import type { Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { toMeta, toWindow } from '../../lib/listQuery';
import { User } from '../users/user.model';
import type { listActivityQuery } from './activity.schema';
import { getRefAuthorizer, registerRefAuthorizer } from './refAuthorizers';

// Users are the one entity that exists today; their visibility is the User scope (branch / self).
registerRefAuthorizer('user', async (principal, id) => Boolean(await scopedRepo(User, principal).exists({ _id: toObjectId(id) })));

/**
 * Timeline / feed. Scope is derived from the principal (branch of the event),
 * and a timeline for a specific entity additionally requires that the actor may
 * see that entity, so an id alone never opens another branch's history.
 */
export async function listActivities(principal: Principal, q: z.infer<typeof listActivityQuery>) {
  const filter: Record<string, unknown> = {};

  if (q.refType && q.refId) {
    const authorize = getRefAuthorizer(q.refType);
    if (!authorize) throw new AppError('TIMELINE_UNAVAILABLE', 400, `Timelines for "${q.refType}" are not available`);
    if (!(await authorize(principal, q.refId))) throw AppError.notFound('Not found');
    filter.refs = { $elemMatch: { type: q.refType, id: toObjectId(q.refId) } };
  } else if (principal.dataScope === 'OWN') {
    // A feed without an entity: people with OWN scope only see what they did themselves.
    filter.userId = toObjectId(principal.userId);
  }

  if (q.type) filter.type = q.type;
  if (q.userId) filter.userId = toObjectId(q.userId);
  if (q.from || q.to) filter.at = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };

  const repo = scopedRepo(Activity, principal, { requestedBranchId: q.branchId });
  const { skip, limit } = toWindow(q);
  const [rows, total] = await Promise.all([
    repo.find(filter).sort({ at: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    repo.countDocuments(filter),
  ]);
  return { rows, meta: toMeta(q, total) };
}
