// Data scope is a fixed system enum (not a business master), so labels live here.
export const DATA_SCOPE_OPTIONS = [
  { value: 'ALL', label: 'All branches' },
  { value: 'BRANCH', label: 'Own branches' },
  { value: 'OWN', label: 'Own records only' },
];

export const dataScopeLabel = (v) => DATA_SCOPE_OPTIONS.find((o) => o.value === v)?.label ?? v;

const humanize = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const permissionGroupLabel = humanize;
export const permissionActionLabel = humanize;
