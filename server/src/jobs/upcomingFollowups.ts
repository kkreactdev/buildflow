import type { Types } from 'mongoose';
import { getEnv } from '../config/env';
import { notify } from '../core/notify/notification.service';
import { systemRepo } from '../core/scope/system';
import { logger } from '../lib/logger';
import { formatLocal } from '../lib/time';
import { withTransaction } from '../lib/transaction';
import { FollowUp } from '../modules/followups/followup.model';
import { SCHEDULED_KEYS } from '../modules/followups/followup.status';
import { Master } from '../modules/masters/master.model';
import type { JobDefinition } from './types';

type Id = Types.ObjectId;

/**
 * Reminds assignees shortly before a follow-up is due. Like the missed sweep, each follow-up is claimed with
 * a conditional update (`upcomingNotifiedAt` not set), so a second or concurrent run reminds nobody twice.
 * Rescheduling clears the marker, so a moved follow-up is reminded again for its new time.
 */
export async function remindUpcomingFollowUps(now = new Date()): Promise<{ reminded: number }> {
  const env = getEnv();
  const horizon = new Date(now.getTime() + env.FOLLOWUP_REMINDER_MINUTES * 60_000);
  const followups = systemRepo(FollowUp, 'job', 'upcoming follow-up reminders');
  const due = await followups
    .find({ statusKey: { $in: SCHEDULED_KEYS }, isArchived: false, upcomingNotifiedAt: null, scheduledAt: { $gte: now, $lte: horizon } })
    .sort({ scheduledAt: 1, _id: 1 })
    .limit(500)
    .lean<{ _id: Id; scheduledAt: Date }[]>();

  let reminded = 0;
  for (const c of due) {
    const did = await withTransaction(async (session) => {
      const f = await followups
        .findOneAndUpdate({ _id: c._id, statusKey: { $in: SCHEDULED_KEYS }, scheduledAt: c.scheduledAt, upcomingNotifiedAt: null, isArchived: false }, { $set: { upcomingNotifiedAt: now } }, { new: true, session })
        .lean<{ _id: Id; branchId: Id; personId: Id; personName: string; enquiryId?: Id | null; clientId?: Id | null; sellerId?: Id | null; sellerPropertyId?: Id | null; assignedTo: Id; typeId: Id; scheduledAt: Date }>();
      if (!f) return false;
      const type = await systemRepo(Master, 'notify', 'follow-up type label').findById(f.typeId.toHexString()).select('label').lean<{ label: string }>();
      await notify({
        event: 'FOLLOWUP_UPCOMING', branchId: f.branchId, session,
        refs: [{ type: 'followup', id: f._id }, ...(f.enquiryId ? [{ type: 'enquiry', id: f.enquiryId }] : []), ...(f.clientId ? [{ type: 'client', id: f.clientId }] : []), ...(f.sellerId ? [{ type: 'seller', id: f.sellerId }] : []), ...(f.sellerPropertyId ? [{ type: 'sellerProperty', id: f.sellerPropertyId }] : [])],
        payload: { person: f.personName, type: type?.label ?? 'Follow-up', when: formatLocal(f.scheduledAt, env.APP_TIMEZONE) },
        subjects: { assignee: f.assignedTo.toHexString() },
        dedupeKey: `followup-upcoming:${f._id}:${f.scheduledAt.getTime()}`,
      });
      return true;
    });
    if (did) reminded++;
  }
  return { reminded };
}

export const upcomingFollowupsJob: JobDefinition = {
  name: 'followups.upcoming',
  schedule: '*/5 * * * *',
  run: async () => {
    const { reminded } = await remindUpcomingFollowUps();
    if (reminded) logger.info({ reminded }, 'Sent upcoming follow-up reminders');
  },
};
