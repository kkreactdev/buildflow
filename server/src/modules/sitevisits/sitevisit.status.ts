/**
 * The SITEVISIT_STATUS system keys business rules depend on. Labels and colours are administrator-editable
 * masters; these keys are the stable contract (seeded with `systemKey`).
 *
 *   SCHEDULED  the only open state: it can be edited, reassigned, completed or cancelled
 *   COMPLETED  the visit happened (terminal)
 *   CANCELLED  the visit will not happen (terminal)
 */
export const VISIT_STATUS = { scheduled: 'SCHEDULED', completed: 'COMPLETED', cancelled: 'CANCELLED' } as const;
export type VisitStatusKey = (typeof VISIT_STATUS)[keyof typeof VISIT_STATUS];

/** Controlled transitions: a status only changes through the lifecycle operation that owns the move. */
export const VISIT_TRANSITIONS: Record<VisitStatusKey, readonly VisitStatusKey[]> = {
  SCHEDULED: [VISIT_STATUS.completed, VISIT_STATUS.cancelled],
  COMPLETED: [],
  CANCELLED: [],
};
export const canMove = (from: string, to: VisitStatusKey): boolean => (VISIT_TRANSITIONS[from as VisitStatusKey] ?? []).includes(to);
export const isOpen = (statusKey: string): boolean => statusKey === VISIT_STATUS.scheduled;
