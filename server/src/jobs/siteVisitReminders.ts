import type { Types } from 'mongoose';
import { getEnv } from '../config/env';
import { notify } from '../core/notify/notification.service';
import { systemRepo } from '../core/scope/system';
import { logger } from '../lib/logger';
import { formatLocal } from '../lib/time';
import { withTransaction } from '../lib/transaction';
import { SiteVisit } from '../modules/sitevisits/sitevisit.model';
import { VISIT_STATUS } from '../modules/sitevisits/sitevisit.status';
import type { JobDefinition } from './types';

type Id = Types.ObjectId;

/**
 * Reminds the assignee shortly before a scheduled site visit. Each visit is claimed with a conditional update
 * (`upcomingNotifiedAt` not set), so a second or concurrent run reminds nobody twice. Rescheduling or
 * reassigning clears the marker, so the new time / new assignee is reminded in turn.
 */
export async function remindUpcomingVisits(now = new Date()): Promise<{ reminded: number }> {
  const env = getEnv();
  const horizon = new Date(now.getTime() + env.SITEVISIT_REMINDER_MINUTES * 60_000);
  const visits = systemRepo(SiteVisit, 'job', 'upcoming site visit reminders');
  const due = await visits
    .find({ statusKey: VISIT_STATUS.scheduled, isArchived: false, upcomingNotifiedAt: null, scheduledAt: { $gte: now, $lte: horizon } })
    .sort({ scheduledAt: 1, _id: 1 })
    .limit(500)
    .lean<{ _id: Id; scheduledAt: Date }[]>();

  let reminded = 0;
  for (const c of due) {
    const did = await withTransaction(async (session) => {
      const v = await visits
        .findOneAndUpdate({ _id: c._id, statusKey: VISIT_STATUS.scheduled, scheduledAt: c.scheduledAt, upcomingNotifiedAt: null, isArchived: false }, { $set: { upcomingNotifiedAt: now } }, { new: true, session })
        .lean<{ _id: Id; visitNo: string; branchId: Id; enquiryId: Id; personName: string; assignedTo: Id; scheduledAt: Date }>();
      if (!v) return false;
      await notify({
        event: 'SITE_VISIT_UPCOMING', branchId: v.branchId, session,
        refs: [{ type: 'sitevisit', id: v._id }, { type: 'enquiry', id: v.enquiryId }],
        payload: { person: v.personName, visit: v.visitNo, when: formatLocal(v.scheduledAt, env.APP_TIMEZONE) },
        subjects: { assignee: v.assignedTo.toHexString() },
        dedupeKey: `sitevisit-upcoming:${v._id}:${v.scheduledAt.getTime()}`,
      });
      return true;
    });
    if (did) reminded++;
  }
  return { reminded };
}

export const siteVisitRemindersJob: JobDefinition = {
  name: 'sitevisits.upcoming',
  schedule: '*/5 * * * *',
  run: async () => {
    const { reminded } = await remindUpcomingVisits();
    if (reminded) logger.info({ reminded }, 'Sent upcoming site visit reminders');
  },
};
