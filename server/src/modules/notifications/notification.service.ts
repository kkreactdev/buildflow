import type { z } from 'zod';
import { Notification } from '../../core/notify/notification.model';
import type { Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { toMeta, toWindow } from '../../lib/listQuery';
import type { listNotificationQuery } from './notification.schema';

/**
 * Notifications are PERSONAL. The branch/ownership scope still applies (scopedRepo), but on top of it
 * every query is pinned to the caller's own id — a wider data scope (BRANCH, ALL) never lets someone
 * read, count or mark another person's notifications.
 */
const mine = (p: Principal) => ({ userId: toObjectId(p.userId) });
const repo = (p: Principal) => scopedRepo(Notification, p);

type Row = { _id: unknown; eventCode: string; title: string; body?: string; refs: { type: string; id: unknown }[]; branchId: unknown; readAt?: Date | null; createdAt?: Date };
const view = (n: Row) => ({
  id: String(n._id), eventCode: n.eventCode, title: n.title, body: n.body, branchId: String(n.branchId),
  refs: n.refs.map((r) => ({ type: r.type, id: String(r.id) })), read: Boolean(n.readAt), readAt: n.readAt ?? undefined, createdAt: n.createdAt,
});

export async function listNotifications(principal: Principal, q: z.infer<typeof listNotificationQuery>) {
  const filter = { ...mine(principal), ...(q.unread ? (q.unread === 'true' ? { readAt: null } : { readAt: { $ne: null } }) : {}) };
  const { skip, limit } = toWindow(q);
  const [rows, total, unread] = await Promise.all([
    repo(principal).find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean<Row[]>(),
    repo(principal).countDocuments(filter),
    unreadCount(principal),
  ]);
  return { rows: rows.map(view), meta: { ...toMeta(q, total), unread } };
}

export const unreadCount = (principal: Principal): Promise<number> => repo(principal).countDocuments({ ...mine(principal), readAt: null });

/** Idempotent: marking an already-read notification is fine. Someone else's (or a made-up id) is a 404. */
export async function markRead(principal: Principal, id: string): Promise<void> {
  const own = await repo(principal).exists({ _id: toObjectId(id), ...mine(principal) });
  if (!own) throw AppError.notFound('Notification not found');
  await repo(principal).updateOne({ _id: toObjectId(id), ...mine(principal), readAt: null }, { $set: { readAt: new Date() } });
}

export async function markAllRead(principal: Principal): Promise<number> {
  const res = await repo(principal).updateMany({ ...mine(principal), readAt: null }, { $set: { readAt: new Date() } });
  return res.modifiedCount;
}
