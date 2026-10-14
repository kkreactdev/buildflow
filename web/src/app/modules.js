import {
  ArchiveIcon,
  BellIcon,
  BuildingIcon,
  DashboardIcon,
  FileTextIcon,
  FormIcon,
  FollowUpIcon,
  HistoryIcon,
  LeadsIcon,
  LinkIcon,
  LocationPinIcon,
  PipelineIcon,
  PersonAddIcon,
  ReportsIcon,
  SettingsIcon,
  ShieldAlertIcon,
  TeamIcon,
  UnitIcon,
} from '../components/ui/icons';

/**
 * Single registry that drives BOTH the router and the sidebar, so navigation
 * can never show a page the router would refuse (or vice versa). `permission`
 * is the key the user needs to *view* the module; the API enforces it again.
 * `phase` = implementation-plan phase in which the real page lands.
 */
export const MODULES = [
  { key: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: DashboardIcon, permission: 'dashboard.view', phase: 12 },
  { key: 'enquiries', path: '/enquiries', label: 'Enquiries', icon: LeadsIcon, permission: 'enquiries.view', phase: 5 },
  { key: 'sitevisits', path: '/site-visits', label: 'Site Visits', icon: LocationPinIcon, permission: 'sitevisits.view', phase: 8 },
  { key: 'followups', path: '/follow-ups', label: 'Follow-ups', icon: FollowUpIcon, permission: 'followups.view', phase: 6 },
  { key: 'clients', path: '/clients', label: 'Clients', icon: PersonAddIcon, permission: 'clients.view', phase: 4 },
  { key: 'units', path: '/units', label: 'Units / Properties', icon: BuildingIcon, permission: 'units.view', phase: 7 },
  { key: 'bookings', path: '/bookings', label: 'Bookings', icon: FileTextIcon, permission: 'bookings.view', phase: 9 },
  { key: 'referrals', path: '/referrals', label: 'Referrals', icon: LinkIcon, permission: 'referrals.view', phase: 10 },
  { key: 'sellers', path: '/sellers', label: 'Sellers', icon: UnitIcon, permission: 'sellers.view', phase: 14 },
  { key: 'activities', path: '/activities', label: 'Activities', icon: HistoryIcon, permission: 'activities.view', phase: 3 },
  { key: 'documents', path: '/documents', label: 'Documents', icon: FileTextIcon, permission: 'documents.view', phase: 11 },
  { key: 'notifications', path: '/notifications', label: 'Notifications', icon: BellIcon, permission: 'notifications.view', phase: 6 },
  { key: 'reports', path: '/reports', label: 'Reports', icon: ReportsIcon, permission: 'reports.view', phase: 12 },
  { key: 'whatsapp', path: '/whatsapp-templates', label: 'WhatsApp Templates', icon: FormIcon, permission: 'whatsapp_masters.view', phase: 11, group: 'Setup' },
  { key: 'masters', path: '/masters', label: 'Masters', icon: ArchiveIcon, permission: 'masters.view', phase: 3, group: 'Setup' },
  { key: 'workflow', path: '/workflow', label: 'Enquiry Workflow', icon: PipelineIcon, permission: 'masters.view', phase: 3, group: 'Setup' },
  { key: 'users', path: '/admin/users', label: 'Users', icon: TeamIcon, permission: 'users.view', phase: 1, group: 'Setup' },
  { key: 'roles', path: '/admin/roles', label: 'Roles & Permissions', icon: ShieldAlertIcon, permission: 'roles.view', phase: 1, group: 'Setup' },
  { key: 'branches', path: '/admin/branches', label: 'Branches', icon: SettingsIcon, permission: 'branches.view', phase: 2, group: 'Setup' },
  { key: 'company', path: '/admin/company', label: 'Company Settings', icon: BuildingIcon, permission: 'company.view', phase: 13, group: 'Setup' },
];


export function findModuleByPath(pathname) {
  return MODULES.find((m) => pathname === m.path || pathname.startsWith(`${m.path}/`));
}

/** Modules the user may see, split into primary and grouped sections. */
export function visibleModules(can) {
  return MODULES.filter((m) => can(m.permission));
}
