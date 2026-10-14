import type { Types } from 'mongoose';
import { getEnv } from '../config/env';
import { recordActivity } from '../core/activity/activity.service';
import { recordAudit } from '../core/audit/audit.service';
import { notify } from '../core/notify/notification.service';
import { systemRepo } from '../core/scope/system';
import { logger } from '../lib/logger';
import { formatLocal } from '../lib/time';
import { withTransaction } from '../lib/transaction';
import { getStatusMaster } from '../modules/followups/followup.masters';
import { FollowUp } from '../modules/followups/followup.model';
import { FOLLOWUP_STATUS, SCHEDULED_KEYS } from '../modules/followups/followup.status';
import { Master } from '../modules/masters/master.model';
import { User } from '../modules/users/user.model';
import type { JobDefinition } from './types';

type Id = Types.ObjectId;
const BATCH = 100;

/**
 * Flags overdue, still-scheduled follow-ups as MISSED and notifies the assignee and the branch's team-alert
 * holders. It runs on the server, so it does not depend on anyone having the app open.
 *
 * Safe to run more than once, even at the same time:
 *  - each follow-up is CLAIMED with a conditional update (still scheduled, same time, not archived). Only
 *    the run whose claim succeeds records the audit entry, the activity and the notifications, in the SAME
 *    transaction as the status change, so nothing is half-done;
 *  - a second or concurrent run finds nothing to claim (the status is no longer scheduled) and does nothing;
 *  - a completion or reschedule that slips in first makes the claim fail, so it is never flagged;
 *  - notifications additionally carry a per-recipient dedupe key as a backstop.
 */
export async function flagMissedFollowUps(now = new Date()): Promise<{ flagged: number }> {
  const cutoff = new Date(now.getTime() - getEnv().FOLLOWUP_MISSED_GRACE_MINUTES * 60_000);
  const missed = await getStatusMaster(FOLLOWUP_STATUS.missed);
  const followups = systemRepo(FollowUp, 'job', 'missed follow-up sweep');
  const tz = getEnv().APP_TIMEZONE;
  let flagged = 0;

  for (;;) {
    const batch = await followups
      .find({ statusKey: { $in: SCHEDULED_KEYS }, isArchived: false, scheduledAt: { $lt: cutoff } })
      .sort({ scheduledAt: 1, _id: 1 })
      .limit(BATCH)
      .lean<{ _id: Id; scheduledAt: Date }[]>();
    if (batch.length === 0) break;

    let progressed = 0;
    for (const candidate of batch) {
      const did = await withTransaction(async (session) => {
        const f = await followups
          .findOneAndUpdate(
            { _id: candidate._id, statusKey: { $in: SCHEDULED_KEYS }, scheduledAt: candidate.scheduledAt, isArchived: false },
            { $set: { statusKey: FOLLOWUP_STATUS.missed, statusId: missed._id, missedAt: now } },
            { new: true, session },
          )
          .lean<{ _id: Id; branchId: Id; personId: Id; personName: string; enquiryId?: Id | null; clientId?: Id | null; sellerId?: Id | null; sellerPropertyId?: Id | null; assignedTo: Id; typeId: Id; scheduledAt: Date }>();
        if (!f) return false; // someone else got there first (another run, a completion, a reschedule)

        const branchId = f.branchId.toHexString();
        const refs = [{ type: 'followup', id: f._id }, ...(f.enquiryId ? [{ type: 'enquiry', id: f.enquiryId }] : []), ...(f.clientId ? [{ type: 'client', id: f.clientId }] : []), ...(f.sellerId ? [{ type: 'seller', id: f.sellerId }] : []), ...(f.sellerPropertyId ? [{ type: 'sellerProperty', id: f.sellerPropertyId }] : []), { type: 'person', id: f.personId }];
        await recordAudit({ entityType: 'followup', entityId: f._id, action: 'missed', before: { statusKey: 'scheduled' }, after: { statusKey: FOLLOWUP_STATUS.missed, scheduledAt: f.scheduledAt }, reason: 'Overdue and not completed', branchId }, { session });
        await recordActivity({ type: 'FOLLOWUP_MISSED', description: `Follow-up with ${f.personName} was missed (due ${formatLocal(f.scheduledAt, tz)})`, branchId, at: now, refs: refs as never }, { session });

        const [type, assignee] = await Promise.all([
          systemRepo(Master, 'notify', 'follow-up type label').findById(f.typeId.toHexString()).select('label').lean<{ label: string }>(),
          systemRepo(User, 'notify', 'assignee name').findById(f.assignedTo.toHexString()).select('name').lean<{ name: string }>(),
        ]);
        await notify({
          event: 'FOLLOWUP_MISSED', branchId, refs, session,
          payload: { person: f.personName, type: type?.label ?? 'Follow-up', when: formatLocal(f.scheduledAt, tz), assignee: assignee?.name ?? '' },
          subjects: { assignee: f.assignedTo.toHexString() },
          dedupeKey: `followup-missed:${f._id}:${f.scheduledAt.getTime()}`,
        });
        return true;
      });
      if (did) {
        flagged++;
        progressed++;
      }
    }
    if (progressed === 0) break; // everything left was claimed elsewhere; do not spin
  }
  return { flagged };
}

export const missedFollowupsJob: JobDefinition = {
  name: 'followups.missed',
  schedule: '*/5 * * * *',
  run: async () => {
    const { flagged } = await flagMissedFollowUps();
    if (flagged) logger.info({ flagged }, 'Flagged missed follow-ups');
  },
};
