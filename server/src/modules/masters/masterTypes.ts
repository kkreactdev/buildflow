import type { PermissionKey } from '../../core/permissions/catalog';

export type MasterScope = 'GLOBAL' | 'BRANCH';

export interface MasterTypeDef {
  /** Canonical key, stored on every value. */
  key: string;
  label: string;
  group: string;
  description: string;
  /**
   * GLOBAL: one list for the whole company, managed by ALL-scope actors.
   * BRANCH: each value belongs to a branch (`branchId` required); BRANCH-scope actors see their
   * branches' values plus nothing else of other branches. See "Master scope decisions" in the plan.
   */
  scope: MasterScope;
  /** Values may be reordered (affects dropdown order). */
  reorderable: boolean;
  /** Values may be deactivated. Values with a `systemKey` never can (code depends on them). */
  disableable: boolean;
  /**
   * Whether hard deletion is ever possible. Even then it additionally requires: no `systemKey`,
   * and at least one registered reference checker (see references.ts) reporting zero uses.
   * Everything else is deactivated, which keeps historical records meaningful.
   */
  deletable: boolean;
  /** Permission needed to create/edit/reorder/delete values (viewing always needs `masters.view`). */
  managePermission: PermissionKey;
  /** The UI offers a colour picker (status-like values). */
  hasColor: boolean;
}

const t = (def: Partial<MasterTypeDef> & Pick<MasterTypeDef, 'key' | 'label' | 'group' | 'description'>): MasterTypeDef => ({
  scope: 'GLOBAL',
  reorderable: true,
  disableable: true,
  deletable: false,
  managePermission: 'masters.manage',
  hasColor: false,
  ...def,
});

/**
 * The only master types that exist. Clients cannot invent types: every API
 * validates the `:type` against this list. Enquiry STATUSES are deliberately
 * not here: they are the configurable workflow stages (see modules/workflow).
 */
export const MASTER_TYPES: readonly MasterTypeDef[] = [
  t({ key: 'ENQUIRY_SOURCE', label: 'Enquiry Sources', group: 'Enquiries', description: 'Where an enquiry came from (walk-in, website, ads…).', deletable: true }),
  t({ key: 'ENQUIRY_TYPE', label: 'Enquiry Types', group: 'Enquiries', description: 'Kind of interest an enquiry expresses.', deletable: true }),
  t({ key: 'LOST_REASON', label: 'Lost Reasons', group: 'Enquiries', description: 'Why an enquiry was marked lost.', deletable: true }),
  t({ key: 'PROPERTY_TYPE', label: 'Property Types', group: 'Properties', description: 'Apartment, villa, plot…', deletable: true }),
  t({ key: 'BUILDING_TYPE', label: 'Building Types', group: 'Properties', description: 'Independent house, high-rise…', deletable: true }),
  // Branch-scoped: each branch serves its own city/localities and maintains its own list.
  t({ key: 'LOCATION', label: 'Locations', group: 'Properties', description: 'Localities/areas used for preferences and units. Maintained per branch.', scope: 'BRANCH', deletable: true }),
  t({ key: 'UNIT_STATUS', label: 'Unit Statuses', group: 'Properties', description: 'Sale state of a unit (code relies on AVAILABLE, BOOKED, SOLD).', hasColor: true }),
  t({ key: 'MEDIA_TYPE', label: 'Media Types', group: 'Properties', description: 'Kinds of unit media (front, floor plan, brochure…).', deletable: true }),
  t({ key: 'FOLLOWUP_TYPE', label: 'Follow-up Types', group: 'Follow-ups & Visits', description: 'Call, WhatsApp, meeting…', deletable: true }),
  t({ key: 'FOLLOWUP_STATUS', label: 'Follow-up Statuses', group: 'Follow-ups & Visits', description: 'State of a follow-up (code relies on PENDING, COMPLETED…).', hasColor: true }),
  t({ key: 'SITEVISIT_STATUS', label: 'Site Visit Statuses', group: 'Follow-ups & Visits', description: 'State of a site visit (code relies on SCHEDULED, COMPLETED…).', hasColor: true }),
  t({ key: 'CLIENT_CATEGORY', label: 'Client Categories', group: 'Clients & Referrals', description: 'Segments for clients.', deletable: true }),
  t({ key: 'REFERRAL_TYPE', label: 'Referral Types', group: 'Clients & Referrals', description: 'Who a referrer is (client, employee, external).' }),
  t({ key: 'SELLER_STATUS', label: 'Seller Statuses', group: 'Sellers', description: 'State of a seller relationship (code relies on REGISTERED, VERIFIED…).', hasColor: true }),
  t({ key: 'PROPERTY_STATUS', label: 'Property Statuses', group: 'Sellers', description: 'State of a proposed seller property (code relies on PROPOSED, PURCHASED, READY_TO_SELL…).', hasColor: true }),
  t({ key: 'DOCUMENT_TYPE', label: 'Document Types', group: 'Documents', description: 'Kinds of uploaded documents.', deletable: true }),
  t({ key: 'ACTIVITY_TYPE', label: 'Activity Types', group: 'System', description: 'Kinds of business events shown on timelines. Referenced by code.', reorderable: false }),
  t({ key: 'WA_CATEGORY', label: 'WhatsApp Categories', group: 'WhatsApp', description: 'Template categories (no messages are sent in V1).', managePermission: 'whatsapp_masters.manage', deletable: true }),
  t({ key: 'WA_EVENT', label: 'WhatsApp Events', group: 'WhatsApp', description: 'Business events a template can be tied to (no messages are sent in V1).', managePermission: 'whatsapp_masters.manage', deletable: true }),
];

const BY_KEY = new Map(MASTER_TYPES.map((d) => [d.key, d]));

export const isMasterType = (key: string): boolean => BY_KEY.has(key);
export const getMasterType = (key: string): MasterTypeDef | undefined => BY_KEY.get(key);
export const MASTER_TYPE_KEYS = MASTER_TYPES.map((d) => d.key) as [string, ...string[]];
