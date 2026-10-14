import { usePermissions } from '../../hooks/usePermissions';
import { ForbiddenPage } from '../../pages/ForbiddenPage';

/** Route-level guard. Missing permission renders a 403 page (fail-closed). */
export function PermissionRoute({ permission, children }) {
  const { can } = usePermissions();
  if (!can(permission)) return <ForbiddenPage />;
  return children;
}
