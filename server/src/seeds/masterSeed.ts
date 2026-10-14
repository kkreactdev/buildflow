/**
 * Initial master values. Deliberately limited to values the approved
 * requirements name or that business code will rely on by `systemKey`.
 * Enquiry sources/types, property/building types, locations, client categories,
 * document types, lost reasons and WhatsApp categories/events are NOT seeded:
 * the requirements give no values, so administrators configure them.
 */
export interface MasterSeed {
  type: string;
  code: string;
  label: string;
  color?: string;
  /** Marks a value code depends on: immutable key, cannot be deactivated or deleted. */
  system?: boolean;
  description?: string;
}

const s = (type: string, code: string, label: string, opts: Partial<MasterSeed> = {}): MasterSeed => ({ type, code, label, ...opts });

export const MASTER_SEEDS: MasterSeed[] = [
  // Named in the requirements; not referenced by code, so admins may rename/deactivate freely.
  s('FOLLOWUP_TYPE', 'CALL', 'Call'),
  s('FOLLOWUP_TYPE', 'WHATSAPP', 'WhatsApp'),
  s('FOLLOWUP_TYPE', 'MEETING', 'Meeting'),
  s('FOLLOWUP_TYPE', 'SITE_VISIT', 'Site Visit'),
  s('FOLLOWUP_TYPE', 'OFFICE_VISIT', 'Office Visit'),
  s('FOLLOWUP_TYPE', 'EMAIL', 'Email'),
  s('FOLLOWUP_TYPE', 'OTHER', 'Other'),
  // Seller Management: price discussions with a seller are scheduled like any other contact.
  s('FOLLOWUP_TYPE', 'NEGOTIATION', 'Negotiation discussion'),

  // The follow-up lifecycle. MISSED is seeded as requested; whether it is stored or derived at
  // query time is decided in the Follow-ups phase (nothing relies on it yet).
  s('FOLLOWUP_STATUS', 'PENDING', 'Pending', { system: true, color: '#3f6690' }),
  s('FOLLOWUP_STATUS', 'COMPLETED', 'Completed', { system: true, color: '#047857' }),
  s('FOLLOWUP_STATUS', 'RESCHEDULED', 'Rescheduled', { system: true, color: '#9a5b0a' }),
  s('FOLLOWUP_STATUS', 'CANCELLED', 'Cancelled', { system: true, color: '#64748b' }),
  s('FOLLOWUP_STATUS', 'MISSED', 'Missed', { system: true, color: '#a3342b' }),

  // Booking/units rely on AVAILABLE and BOOKED; the requirements name "Sold" on the unit timeline.
  s('UNIT_STATUS', 'AVAILABLE', 'Available', { system: true, color: '#047857' }),
  s('UNIT_STATUS', 'BOOKED', 'Booked', { system: true, color: '#9a5b0a' }),
  s('UNIT_STATUS', 'SOLD', 'Sold', { system: true, color: '#64748b' }),
  // Seller Management owns this one: a unit bought from a seller is created here and leaves it only when
  // its property is marked Ready to Sell, so refurbishment stock never counts as available inventory.
  s('UNIT_STATUS', 'UNDER_DEVELOPMENT', 'Under development', { system: true, color: '#b45309' }),

  // Site-visit flow: scheduled → completed (completion drives the next-day follow-up); cancellation is a normal outcome.
  s('SITEVISIT_STATUS', 'SCHEDULED', 'Scheduled', { system: true, color: '#3f6690' }),
  s('SITEVISIT_STATUS', 'COMPLETED', 'Completed', { system: true, color: '#047857' }),
  s('SITEVISIT_STATUS', 'CANCELLED', 'Cancelled', { system: true, color: '#64748b' }),

  // "Client, Employee, External" per the referral requirements.
  s('REFERRAL_TYPE', 'CLIENT', 'Client', { system: true }),
  s('REFERRAL_TYPE', 'EMPLOYEE', 'Employee', { system: true }),
  s('REFERRAL_TYPE', 'EXTERNAL', 'External', { system: true }),

  // "Front image, Exterior, Interior, Floor plan, Brochure, Other" per the unit media requirements.
  s('MEDIA_TYPE', 'FRONT', 'Front image'),
  s('MEDIA_TYPE', 'EXTERIOR', 'Exterior'),
  s('MEDIA_TYPE', 'INTERIOR', 'Interior'),
  s('MEDIA_TYPE', 'FLOOR_PLAN', 'Floor plan'),
  s('MEDIA_TYPE', 'BROCHURE', 'Brochure'),
  s('MEDIA_TYPE', 'OTHER', 'Other'),

  // Business events named in the requirements (activities are recorded by these codes).
  s('ACTIVITY_TYPE', 'ENQUIRY_CREATED', 'Enquiry created', { system: true }),
  s('ACTIVITY_TYPE', 'ENQUIRY_STAGE_CHANGED', 'Enquiry stage changed', { system: true }),
  s('ACTIVITY_TYPE', 'ENQUIRY_ASSIGNED', 'Enquiry assigned', { system: true }),
  s('ACTIVITY_TYPE', 'PERSON_LINKED', 'Existing person linked', { system: true }),
  s('ACTIVITY_TYPE', 'FOLLOWUP_SCHEDULED', 'Follow-up scheduled', { system: true }),
  s('ACTIVITY_TYPE', 'FOLLOWUP_COMPLETED', 'Follow-up completed', { system: true }),
  s('ACTIVITY_TYPE', 'SITE_VISIT_SCHEDULED', 'Site visit scheduled', { system: true }),
  s('ACTIVITY_TYPE', 'SITE_VISIT_COMPLETED', 'Site visit completed', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_ASSIGNED', 'Unit assigned', { system: true }),
  s('ACTIVITY_TYPE', 'BOOKING_CREATED', 'Booking created', { system: true }),
  s('ACTIVITY_TYPE', 'BOOKING_RELEASED', 'Booking released', { system: true }),
  s('ACTIVITY_TYPE', 'BOOKING_UPDATED', 'Booking updated', { system: true }),
  s('ACTIVITY_TYPE', 'BOOKING_CONFLICT', 'Booking conflict', { system: true }),
  s('ACTIVITY_TYPE', 'BOOKING_CONFLICT_RESOLVED', 'Booking conflict resolved', { system: true }),
  s('ACTIVITY_TYPE', 'CLIENT_CONVERTED', 'Client converted', { system: true }),
  s('ACTIVITY_TYPE', 'REFERRAL_CREATED', 'Referral created', { system: true }),
  s('ACTIVITY_TYPE', 'REFERRAL_UPDATED', 'Referral updated', { system: true }),
  s('ACTIVITY_TYPE', 'REFERRAL_ASSIGNED', 'Referral assigned', { system: true }),
  s('ACTIVITY_TYPE', 'REFERRAL_ARCHIVED', 'Referral archived', { system: true }),
  s('ACTIVITY_TYPE', 'REFERRAL_LINKED', 'Referral linked to an enquiry', { system: true }),
  s('ACTIVITY_TYPE', 'REFERRAL_UNLINKED', 'Referral unlinked from an enquiry', { system: true }),
  s('ACTIVITY_TYPE', 'DOCUMENT_UPLOADED', 'Document uploaded', { system: true }),
  s('ACTIVITY_TYPE', 'DOCUMENT_UPDATED', 'Document updated', { system: true }),
  s('ACTIVITY_TYPE', 'DOCUMENT_REPLACED', 'Document file replaced', { system: true }),
  s('ACTIVITY_TYPE', 'DOCUMENT_ARCHIVED', 'Document archived', { system: true }),
  s('ACTIVITY_TYPE', 'CLIENT_CREATED', 'Client created', { system: true }),
  s('ACTIVITY_TYPE', 'CLIENT_UPDATED', 'Client updated', { system: true }),
  s('ACTIVITY_TYPE', 'CLIENT_ARCHIVED', 'Client archived', { system: true }),
  s('ACTIVITY_TYPE', 'ENQUIRY_UPDATED', 'Enquiry updated', { system: true }),
  s('ACTIVITY_TYPE', 'ENQUIRY_LOST', 'Enquiry marked lost', { system: true }),
  s('ACTIVITY_TYPE', 'ENQUIRY_REOPENED', 'Enquiry reopened', { system: true }),
  s('ACTIVITY_TYPE', 'ENQUIRY_ARCHIVED', 'Enquiry archived', { system: true }),
  s('ACTIVITY_TYPE', 'FOLLOWUP_UPDATED', 'Follow-up updated', { system: true }),
  s('ACTIVITY_TYPE', 'FOLLOWUP_RESCHEDULED', 'Follow-up rescheduled', { system: true }),
  s('ACTIVITY_TYPE', 'FOLLOWUP_CANCELLED', 'Follow-up cancelled', { system: true }),
  s('ACTIVITY_TYPE', 'FOLLOWUP_MISSED', 'Follow-up missed', { system: true }),
  s('ACTIVITY_TYPE', 'FOLLOWUP_ARCHIVED', 'Follow-up archived', { system: true }),
  s('ACTIVITY_TYPE', 'SITE_VISIT_CREATED', 'Site visit created', { system: true }),
  s('ACTIVITY_TYPE', 'SITE_VISIT_UPDATED', 'Site visit updated', { system: true }),
  s('ACTIVITY_TYPE', 'SITE_VISIT_ASSIGNED', 'Site visit assigned', { system: true }),
  s('ACTIVITY_TYPE', 'SITE_VISIT_CANCELLED', 'Site visit cancelled', { system: true }),
  s('ACTIVITY_TYPE', 'SITE_VISIT_ARCHIVED', 'Site visit archived', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_INTEREST_ADDED', 'Unit interest added', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_INTEREST_WITHDRAWN', 'Unit interest withdrawn', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_CREATED', 'Unit created', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_UPDATED', 'Unit updated', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_STATUS_CHANGED', 'Unit status changed', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_ARCHIVED', 'Unit archived', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_MEDIA_ADDED', 'Unit media added', { system: true }),
  s('ACTIVITY_TYPE', 'UNIT_MEDIA_REMOVED', 'Unit media removed', { system: true }),

  // ---- Seller Management -------------------------------------------------------------------------
  // Seller lifecycle. The seller record tracks the RELATIONSHIP (is this person still a prospective
  // seller we work with); it is deliberately independent of the status of any one property they offer,
  // so one seller can offer several properties at different stages.
  s('SELLER_STATUS', 'REGISTERED', 'Registered', { system: true, color: '#3f6690' }),
  s('SELLER_STATUS', 'VERIFIED', 'Verified', { system: true, color: '#047857' }),
  s('SELLER_STATUS', 'REJECTED', 'Rejected', { system: true, color: '#a3342b' }),
  s('SELLER_STATUS', 'INACTIVE', 'Inactive', { system: true, color: '#64748b' }),

  // Proposed-property lifecycle, up to and including purchase. Property approval and company
  // acquisition are separate axes from inventory status: nothing here is a UNIT_STATUS, so a
  // seller-originated property never appears in the unit board until a Unit actually exists.
  s('PROPERTY_STATUS', 'PROPOSED', 'Proposed', { system: true, color: '#3f6690' }),
  s('PROPERTY_STATUS', 'UNDER_VERIFICATION', 'Under verification', { system: true, color: '#9a5b0a' }),
  s('PROPERTY_STATUS', 'VERIFIED', 'Verified', { system: true, color: '#047857' }),
  s('PROPERTY_STATUS', 'NEGOTIATION', 'Negotiation', { system: true, color: '#943a17' }),
  s('PROPERTY_STATUS', 'APPROVED', 'Approved', { system: true, color: '#047857' }),
  s('PROPERTY_STATUS', 'PURCHASED', 'Purchased', { system: true, color: '#065f46' }),
  s('PROPERTY_STATUS', 'REFURBISHMENT', 'Refurbishment / development', { system: true, color: '#b45309' }),
  s('PROPERTY_STATUS', 'READY_TO_SELL', 'Ready to sell', { system: true, color: '#047857' }),
  s('PROPERTY_STATUS', 'REJECTED', 'Rejected', { system: true, color: '#a3342b' }),
  s('PROPERTY_STATUS', 'WITHDRAWN', 'Withdrawn', { system: true, color: '#64748b' }),

  s('ACTIVITY_TYPE', 'SELLER_CREATED', 'Seller registered', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_UPDATED', 'Seller updated', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_STATUS_CHANGED', 'Seller status changed', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_ASSIGNED', 'Seller assigned', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_CREATED', 'Proposed property registered', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_UPDATED', 'Proposed property updated', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_STATUS_CHANGED', 'Proposed property status changed', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_VERIFIED', 'Proposed property verified', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_NEGOTIATION', 'Price negotiation recorded', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_APPROVED', 'Proposed property approved', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_PURCHASED', 'Purchase completed and unit created', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_REFURB_STARTED', 'Refurbishment / development started', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_WORK_UPDATED', 'Refurbishment / development progress recorded', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_WORK_COMPLETED', 'Refurbishment / development completed', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_READY_TO_SELL', 'Property marked ready to sell', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_REJECTED', 'Proposed property rejected', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_PROPERTY_WITHDRAWN', 'Proposed property withdrawn', { system: true }),
  s('ACTIVITY_TYPE', 'SELLER_ARCHIVED', 'Seller archived', { system: true }),
];
