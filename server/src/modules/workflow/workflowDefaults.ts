/**
 * The canonical enquiry pipeline. These `systemKey`s are the contract between
 * configuration and code: business code references them, never display names.
 * Admins can rename/recolour/describe stages and insert their own stages
 * BETWEEN these, but cannot remove, re-key, or reorder the canonical ones.
 */
export const DOMAIN_OPERATIONS = {
  scheduleVisit: 'sitevisit.schedule',
  completeVisit: 'sitevisit.complete',
  createBooking: 'booking.create',
  convertEnquiry: 'enquiry.convert',
} as const;
export type DomainOperation = (typeof DOMAIN_OPERATIONS)[keyof typeof DOMAIN_OPERATIONS];

export type StageKind = 'FLOW' | 'LOST';
export type EntryPolicy = 'MANUAL' | 'DOMAIN';

export interface CanonicalStage {
  systemKey: string;
  label: string;
  description: string;
  color: string;
  kind: StageKind;
  /** MANUAL: a user with the right permission may move an enquiry in. DOMAIN: only the named domain operation may. */
  entryPolicy: EntryPolicy;
  domainOperation?: DomainOperation;
}

export const CANONICAL_STAGES: readonly CanonicalStage[] = [
  { systemKey: 'NEW', label: 'New', description: 'Just received.', color: '#3f6690', kind: 'FLOW', entryPolicy: 'MANUAL' },
  { systemKey: 'CONTACTED', label: 'Contacted', description: 'First contact made.', color: '#64748b', kind: 'FLOW', entryPolicy: 'MANUAL' },
  { systemKey: 'INTERESTED', label: 'Interested', description: 'Showed genuine interest.', color: '#0891b2', kind: 'FLOW', entryPolicy: 'MANUAL' },
  { systemKey: 'SITE_VISIT_SCHEDULED', label: 'Site Visit Scheduled', description: 'Entered by scheduling a site visit.', color: '#9a5b0a', kind: 'FLOW', entryPolicy: 'DOMAIN', domainOperation: DOMAIN_OPERATIONS.scheduleVisit },
  { systemKey: 'SITE_VISIT_COMPLETED', label: 'Site Visit Completed', description: 'Entered by completing a site visit.', color: '#b45309', kind: 'FLOW', entryPolicy: 'DOMAIN', domainOperation: DOMAIN_OPERATIONS.completeVisit },
  { systemKey: 'NEGOTIATION', label: 'Negotiation', description: 'Discussing price and terms.', color: '#943a17', kind: 'FLOW', entryPolicy: 'MANUAL' },
  { systemKey: 'BOOKED', label: 'Booked', description: 'Entered by booking a unit.', color: '#047857', kind: 'FLOW', entryPolicy: 'DOMAIN', domainOperation: DOMAIN_OPERATIONS.createBooking },
  { systemKey: 'CONVERTED', label: 'Converted', description: 'Entered by converting to a client.', color: '#065f46', kind: 'FLOW', entryPolicy: 'DOMAIN', domainOperation: DOMAIN_OPERATIONS.convertEnquiry },
  { systemKey: 'LOST', label: 'Lost', description: 'Controlled exit state; requires a reason.', color: '#a3342b', kind: 'LOST', entryPolicy: 'MANUAL' },
];

/** Canonical FLOW stages in their fixed relative order. */
export const CANONICAL_FLOW_KEYS: readonly string[] = CANONICAL_STAGES.filter((s) => s.kind === 'FLOW').map((s) => s.systemKey);
export const FIRST_STAGE = 'NEW';
export const LAST_STAGE = 'CONVERTED';
export const LOST_STAGE = 'LOST';
