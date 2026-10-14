import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { Topbar } from '../components/layout/Topbar';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { resetDialogScrollLock } from '../hooks/useDialogBehavior';
import './AppShell.css';

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  // Sidebar links close the drawer themselves; here we only free a lingering scroll lock.
  useEffect(() => {
    resetDialogScrollLock();
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="app-main">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="app-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
