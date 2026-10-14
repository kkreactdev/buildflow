/** Where each document record type is shown in the app (the list of types themselves comes from the server). */
const PATHS = { client: '/clients', enquiry: '/enquiries', unit: '/units', sitevisit: '/site-visits', booking: '/bookings', referral: '/referrals' };
export const entityPath = (type, id) => (PATHS[type] ? `${PATHS[type]}/${id}` : null);
export const sizeLabel = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
