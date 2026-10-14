/**
 * The FOLLOWUP_STATUS system keys business rules depend on. Their labels and colours are
 * administrator-editable masters; these keys are the stable contract (values seeded with `systemKey`).
 *
 * Open = still has to be done:
 *   PENDING / RESCHEDULED  scheduled, not yet overdue
 *   MISSED                 set by the missed-follow-up job once overdue (still open: it can be completed or rescheduled late)
 * Closed = COMPLETED / CANCELLED.
 */
export const FOLLOWUP_STATUS = { pending: 'PENDING', completed: 'COMPLETED', rescheduled: 'RESCHEDULED', cancelled: 'CANCELLED', missed: 'MISSED' } as const;
export type FollowUpStatusKey = (typeof FOLLOWUP_STATUS)[keyof typeof FOLLOWUP_STATUS];

/** Scheduled and not yet flagged overdue: what the job may turn into MISSED, and what "today"/"upcoming" show. */
export const SCHEDULED_KEYS: readonly FollowUpStatusKey[] = [FOLLOWUP_STATUS.pending, FOLLOWUP_STATUS.rescheduled];
/** Everything that can still be completed, rescheduled, cancelled or edited. */
export const OPEN_KEYS: readonly FollowUpStatusKey[] = [...SCHEDULED_KEYS, FOLLOWUP_STATUS.missed];
