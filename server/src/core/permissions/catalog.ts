/**
 * Single source of truth for permissions. Keys are `${resource}.${action}`.
 * Code checks permission keys only — never role names. The role editor and the
 * frontend read this list from the API; nothing duplicates it.
 */
export const PERMISSION_CATALOG = {
  dashboard: ['view'],
  enquiries: ['view', 'create', 'edit', 'archive', 'assign', 'export', 'convert', 'revert', 'lose', 'reopen'],
  // lookup: check whether a phone number already exists; create/edit: identity records; link: attach an existing person to your branch.
  persons: ['lookup', 'create', 'edit', 'link'],
  clients: ['view', 'create', 'edit', 'archive', 'export'],
  // edit covers update, complete, reschedule and cancel; archive hides a follow-up.
  followups: ['view', 'create', 'edit', 'archive', 'export'],
  sitevisits: ['view', 'create', 'edit', 'archive', 'assign', 'complete', 'cancel', 'export'],
  units: ['view', 'create', 'edit', 'archive', 'assign', 'export', 'manage_media', 'change_status'],
  bookings: ['view', 'create', 'edit', 'release', 'resolve_conflict', 'export'],
  referrals: ['view', 'create', 'edit', 'archive', 'assign', 'export'],
  // Sellers and the properties they offer. The workflow actions are separate permissions so a
  // salesperson can register and verify without being able to approve a purchase or release a unit
  // to buyers: verify (verification outcome), approve (approve for purchase), purchase (confirm
  // purchase and create the unit), refurbish (development tracking), release (mark ready to sell).
  sellers: ['view', 'create', 'edit', 'archive', 'assign', 'export', 'verify', 'approve', 'purchase', 'refurbish', 'release'],
  documents: ['view', 'upload', 'edit', 'archive'],
  activities: ['view'],
  // view: your own notifications. team_alerts: also be told about your branch's team (e.g. missed follow-ups) — who counts as "a manager" is decided by this permission, never by a role name.
  notifications: ['view', 'team_alerts'],
  reports: ['view', 'export'],
  masters: ['view', 'manage'],
  whatsapp_masters: ['view', 'manage'],
  users: ['view', 'create', 'edit'],
  roles: ['view', 'manage'],
  branches: ['view', 'manage'],
  /** Company profile (name, logo, legal details). Company-wide, not per branch. */
  company: ['view', 'manage'],
  audit: ['view'],
} as const satisfies Record<string, readonly string[]>;

type Catalog = typeof PERMISSION_CATALOG;
export type PermissionResource = keyof Catalog;
export type PermissionKey = {
  [R in PermissionResource]: `${R}.${Catalog[R][number]}`;
}[PermissionResource];

/** Grants every permission, including ones added later. Only the Super Admin role holds it. */
export const WILDCARD = '*' as const;

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = (
  Object.entries(PERMISSION_CATALOG) as [string, readonly string[]][]
).flatMap(([resource, actions]) => actions.map((a) => `${resource}.${a}` as PermissionKey));

const KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return KEY_SET.has(value);
}

/** True for catalog keys and the wildcard; used to validate role payloads. */
export function isGrantable(value: string): boolean {
  return value === WILDCARD || KEY_SET.has(value);
}
