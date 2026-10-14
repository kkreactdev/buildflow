/**
 * What can be notified and WHO is told. Recipients are declared here as data (rules), not scattered
 * through business code, and are never role names:
 *  - `subject`: a user named by the caller's context (e.g. the follow-up's assignee);
 *  - `branchPermission`: active users who belong to the event's branch and hold a permission (Super
 *    Admin's wildcard counts). "Branch manager" is therefore simply "holds notifications.team_alerts".
 */
export type RecipientRule =
  | { kind: 'subject'; name: string }
  | { kind: 'branchPermission'; permission: string };

export interface NotificationEventDef {
  title: (p: Record<string, string>) => string;
  body: (p: Record<string, string>) => string;
  recipients: readonly RecipientRule[];
}

export const NOTIFICATION_EVENTS = {
  FOLLOWUP_ASSIGNED: {
    title: (p) => `Follow-up assigned: ${p.person}`,
    body: (p) => `${p.type} on ${p.when}${p.by ? ` — assigned by ${p.by}` : ''}`,
    recipients: [{ kind: 'subject', name: 'assignee' }],
  },
  FOLLOWUP_UPCOMING: {
    title: (p) => `Follow-up due soon: ${p.person}`,
    body: (p) => `${p.type} at ${p.when}`,
    recipients: [{ kind: 'subject', name: 'assignee' }],
  },
  FOLLOWUP_MISSED: {
    title: (p) => `Missed follow-up: ${p.person}`,
    body: (p) => `${p.type} was due ${p.when}${p.assignee ? ` (assigned to ${p.assignee})` : ''}`,
    recipients: [
      { kind: 'subject', name: 'assignee' },
      { kind: 'branchPermission', permission: 'notifications.team_alerts' },
    ],
  },
  SITE_VISIT_ASSIGNED: {
    title: (p) => `Site visit assigned: ${p.person}`,
    body: (p) => `${p.visit} on ${p.when}${p.by ? ` — assigned by ${p.by}` : ''}`,
    recipients: [{ kind: 'subject', name: 'assignee' }],
  },
  SITE_VISIT_UPCOMING: {
    title: (p) => `Site visit soon: ${p.person}`,
    body: (p) => `${p.visit} at ${p.when}`,
    recipients: [{ kind: 'subject', name: 'assignee' }],
  },
  BOOKING_CREATED: {
    title: (p) => `Unit booked: ${p.unit}`,
    body: (p) => `${p.booking} for ${p.person}${p.by ? ` — booked by ${p.by}` : ''}`,
    recipients: [{ kind: 'branchPermission', permission: 'notifications.team_alerts' }],
  },
  BOOKING_CONFLICT: {
    title: (p) => `Booking conflict: ${p.unit}`,
    body: (p) => `${p.by ?? 'Someone'} tried to book ${p.unit} for ${p.person}, but it is already booked. Review it in the conflict queue.`,
    recipients: [{ kind: 'branchPermission', permission: 'notifications.team_alerts' }],
  },
  BOOKING_RELEASED: {
    title: (p) => `Booking released: ${p.unit}`,
    body: (p) => `${p.booking} for ${p.person} was released${p.by ? ` by ${p.by}` : ''}: ${p.reason}`,
    recipients: [{ kind: 'subject', name: 'salesperson' }, { kind: 'branchPermission', permission: 'notifications.team_alerts' }],
  },
} as const satisfies Record<string, NotificationEventDef>;

export type NotificationEventCode = keyof typeof NOTIFICATION_EVENTS;
