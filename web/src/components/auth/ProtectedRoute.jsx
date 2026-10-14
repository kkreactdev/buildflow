import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Skeleton } from '../ui/Skeleton';

/**
 * Authentication boundary. While the session is being restored nothing
 * protected renders (no flash of content, no redirect loop); anything other
 * than a confirmed session ends at /login.
 */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="page-center" role="status" aria-label="Loading">
        <Skeleton width={220} height={18} />
      </div>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}
