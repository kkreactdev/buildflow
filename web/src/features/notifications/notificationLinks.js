/** Where a notification should take you, from the records it references (most specific first). */
export function notificationTarget(refs = []) {
  const referral = refs.find((r) => r.type === 'referral');
  if (referral) return `/referrals/${referral.id}`;
  const booking = refs.find((r) => r.type === 'booking');
  if (booking) return `/bookings/${booking.id}`;
  const visit = refs.find((r) => r.type === 'sitevisit');
  if (visit) return `/site-visits/${visit.id}`;
  const enquiry = refs.find((r) => r.type === 'enquiry');
  if (enquiry) return `/enquiries/${enquiry.id}`;
  const client = refs.find((r) => r.type === 'client');
  if (client) return `/clients/${client.id}`;
  if (refs.some((r) => r.type === 'followup')) return '/follow-ups?view=all';
  return null;
}
