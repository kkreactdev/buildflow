/** Interest progress as the unit page shows it (derived by the server from real visits and bookings). */
export const PROGRESS = {
  INTERESTED: { label: 'Interested', color: '#2563eb' },
  SITE_VISIT_SCHEDULED: { label: 'Site visit planned', color: '#0284c7' },
  SITE_VISIT_COMPLETED: { label: 'Site visit completed', color: '#0d9488' },
  BOOKED: { label: 'Booked', color: '#16a34a' },
  BOOKING_RELEASED: { label: 'Booking released', color: '#dc2626' },
  WITHDRAWN: { label: 'Not interested', color: '#64748b' },
};

/** The ONE relationship an enquiry or client has with a unit (server-derived, strongest fact wins). Never the unit's own inventory status. */
export const STATE = {
  SOLD: { label: 'Sold', color: '#7c3aed' },
  BOOKED: { label: 'Booked', color: '#16a34a' },
  NOT_INTERESTED: { label: 'Not interested', color: '#64748b' },
  SITE_VISIT_COMPLETED: { label: 'Site visit completed', color: '#0d9488' },
  SITE_VISIT_SCHEDULED: { label: 'Site visit planned', color: '#0284c7' },
  INTERESTED: { label: 'Interested', color: '#2563eb' },
  BOOKING_RELEASED: { label: 'Booking released', color: '#dc2626' },
};

/** What can be recorded by hand, and why the others cannot. */
export const STATUS_CHOICES = [
  { value: 'INTERESTED', label: 'Interested' },
  { value: 'NOT_INTERESTED', label: 'Not interested' },
  { value: 'SITE_VISIT', label: 'Site visit — created by scheduling a visit', disabled: true },
  { value: 'HOLD', label: 'Hold — not available (needs reservation and expiry rules)', disabled: true },
  { value: 'BOOKED', label: 'Booked — use Book unit', disabled: true },
  { value: 'SOLD', label: 'Sold — follows from the sale, not set here', disabled: true },
];
