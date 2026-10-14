import { ALL_PERMISSION_KEYS, WILDCARD, type PermissionKey } from '../core/permissions/catalog';
import type { DataScope } from '../core/permissions/principal';

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  dataScope: DataScope;
  permissions: string[];
}

const all = [...ALL_PERMISSION_KEYS];
const notIn = (excluded: PermissionKey[]) => all.filter((p) => !excluded.includes(p));

/** Manager: runs a branch. Everything operational, plus revert/resolve/release; no role/branch administration. */
const MANAGER: PermissionKey[] = [
  'dashboard.view',
  'enquiries.view', 'enquiries.create', 'enquiries.edit', 'enquiries.archive', 'enquiries.assign', 'enquiries.export', 'enquiries.convert', 'enquiries.revert', 'enquiries.lose', 'enquiries.reopen',
  'persons.lookup', 'persons.create', 'persons.edit', 'persons.link',
  'clients.view', 'clients.create', 'clients.edit', 'clients.archive', 'clients.export',
  'followups.view', 'followups.create', 'followups.edit', 'followups.archive', 'followups.export',
  'sitevisits.view', 'sitevisits.create', 'sitevisits.edit', 'sitevisits.archive', 'sitevisits.assign', 'sitevisits.complete', 'sitevisits.cancel', 'sitevisits.export',
  'units.view', 'units.create', 'units.edit', 'units.archive', 'units.assign', 'units.export', 'units.manage_media', 'units.change_status',
  'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.release', 'bookings.resolve_conflict', 'bookings.export',
  'referrals.view', 'referrals.create', 'referrals.edit', 'referrals.archive', 'referrals.assign', 'referrals.export',
  // A manager runs the seller desk: registration through to releasing stock to buyers. The purchase
  // and release keys are included deliberately; restrict them per role if the business wants a split.
  'sellers.view', 'sellers.create', 'sellers.edit', 'sellers.archive', 'sellers.assign', 'sellers.export',
  'sellers.verify', 'sellers.approve', 'sellers.purchase', 'sellers.refurbish', 'sellers.release',
  'documents.view', 'documents.upload', 'documents.edit', 'documents.archive',
  'activities.view', 'notifications.view', 'notifications.team_alerts',
  'reports.view', 'reports.export',
  'masters.view',
  'users.view', 'branches.view',
];

/** Sales Executive: works their own enquiries, follow-ups and visits. No reverting, releasing, exporting or administration. */
const SALES_EXECUTIVE: PermissionKey[] = [
  'dashboard.view',
  'enquiries.view', 'enquiries.create', 'enquiries.edit', 'enquiries.convert', 'enquiries.lose',
  'persons.lookup',
  'clients.view', 'clients.create', 'clients.edit',
  'followups.view', 'followups.create', 'followups.edit',
  'sitevisits.view', 'sitevisits.create', 'sitevisits.edit', 'sitevisits.complete', 'sitevisits.cancel',
  'units.view',
  // Sellers: a rep registers sellers and their proposed properties, and logs verification notes and
  // negotiation. Approving, completing a purchase and releasing stock stay with a manager.
  'sellers.view', 'sellers.create', 'sellers.edit', 'sellers.verify',
  'bookings.view', 'bookings.create',
  'referrals.view', 'referrals.create',
  'documents.view', 'documents.upload',
  'activities.view', 'notifications.view',
  'masters.view',
];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full access to everything, including roles and branches.', dataScope: 'ALL', permissions: [WILDCARD] },
  { key: 'ADMIN', name: 'Admin', description: 'Administers users, masters and all branches. Cannot edit roles.', dataScope: 'ALL', permissions: notIn(['roles.manage']) },
  { key: 'MANAGER', name: 'Manager', description: 'Runs a branch: team, enquiries, bookings and conflict resolution.', dataScope: 'BRANCH', permissions: MANAGER },
  { key: 'SALES_EXECUTIVE', name: 'Sales Executive', description: 'Works their own enquiries, follow-ups and site visits.', dataScope: 'OWN', permissions: SALES_EXECUTIVE },
];
