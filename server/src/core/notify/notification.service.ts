import type { ClientSession, Types } from 'mongoose';
import { toObjectId } from '../../lib/ids';
import { systemRepo } from '../scope/system';
import { NOTIFICATION_EVENTS, type NotificationEventCode } from './events';
import { Notification } from './notification.model';
import { resolveRecipients } from './recipients';

export interface NotifyInput {
  event: NotificationEventCode;
  branchId: string | Types.ObjectId;
  /** Values the event's title/body templates use. */
  payload: Record<string, string>;
  /** User ids the event's `subject` rules refer to. */
  subjects?: Record<string, string | undefined>;
  refs: { type: string; id: string | Types.ObjectId }[];
  /** One logical occurrence of the event, e.g. `followup-missed:<id>:<scheduledAt>`. Each recipient gets it at most once. */
  dedupeKey: string;
  /** Do not notify the person who caused the event. */
  excludeUserId?: string;
  session?: ClientSession;
}

const channels = {
  /** The only delivery channel today: persist an in-app notification. Others (email, push) plug in here later. */
  IN_APP: async (docs: Record<string, unknown>[], session?: ClientSession) => {
    if (docs.length) await systemRepo(Notification, 'notify', 'in-app notification').insertMany(docs, { session, ordered: true });
  },
};

/**
 * Creates the notifications for an event according to the event's recipient rules. Idempotent per
 * (dedupeKey, recipient): a recipient who already has this occurrence is skipped, so running the same
 * job twice cannot notify twice. Returns the number of notifications created.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const def = NOTIFICATION_EVENTS[input.event];
  const branchId = String(input.branchId);
  let recipients = await resolveRecipients(def.recipients, { branchId, subjects: input.subjects ?? {} });
  if (input.excludeUserId) recipients = recipients.filter((r) => r !== input.excludeUserId);
  if (recipients.length === 0) return 0;

  const keys = recipients.map((r) => `${input.dedupeKey}:${r}`);
  const existing = await systemRepo(Notification, 'notify', 'notification dedupe').find({ dedupeKey: { $in: keys } }).select('dedupeKey').lean<{ dedupeKey: string }[]>();
  const have = new Set(existing.map((e) => e.dedupeKey));

  const docs = recipients
    .filter((_, i) => !have.has(keys[i]!))
    .map((userId) => ({
      userId: toObjectId(userId),
      branchId: toObjectId(branchId),
      eventCode: input.event,
      channel: 'IN_APP',
      title: def.title(input.payload),
      body: def.body(input.payload),
      refs: input.refs.map((r) => ({ type: r.type, id: toObjectId(String(r.id)) })),
      dedupeKey: `${input.dedupeKey}:${userId}`,
    }));
  await channels.IN_APP(docs, input.session);
  return docs.length;
}
