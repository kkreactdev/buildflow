import { usePermissions } from '../../hooks/usePermissions';

/** Renders children only if the user holds the permission (or any/all of several). */
export function PermissionGate({ perm, any, all, fallback = null, children }) {
  const { can, canAny, canAll } = usePermissions();
  const allowed = perm ? can(perm) : any ? canAny(any) : all ? canAll(all) : false;
  return allowed ? children : fallback;
}
