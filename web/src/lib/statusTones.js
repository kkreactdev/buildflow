/**
 * One colour per well-known record state, used by every status badge, chart and indicator in the app, so a state looks the
 * same everywhere (a missed follow-up is red on the dashboard, in lists and on detail pages). Statuses an administrator adds
 * in Masters have no entry here and keep the colour configured for them.
 */
export const STATUS_COLORS = {
  // unit status
  AVAILABLE: '#16a34a', BOOKED: '#2563eb', SOLD: '#7c3aed', UNDER_DEVELOPMENT: '#b45309',
  // follow-up status
  PENDING: '#d97706', RESCHEDULED: '#0891b2', COMPLETED: '#16a34a', CANCELLED: '#64748b', MISSED: '#dc2626',
  // site-visit status (COMPLETED / CANCELLED shared with the above)
  SCHEDULED: '#0284c7',
  // booking state
  ACTIVE: '#0d9488', RELEASED: '#dc2626',
};

/** The colour for a status: the fixed semantic one when the key is well known, otherwise the configured master colour. */
export const statusColor = (key, configured) => STATUS_COLORS[String(key ?? '').toUpperCase()] ?? configured ?? undefined;
