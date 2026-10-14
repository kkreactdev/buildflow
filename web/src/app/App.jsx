import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PermissionRoute } from '../components/auth/PermissionRoute';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';
import { Skeleton } from '../components/ui/Skeleton';
import { BranchesPage } from '../features/admin/BranchesPage';
import { CompanySettingsPage } from '../features/settings/CompanySettingsPage';
import { RolesPage } from '../features/admin/RolesPage';
import { UsersPage } from '../features/admin/UsersPage';
import { ClientsRoutes } from '../features/clients/ClientsRoutes';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { DocumentsRoutes } from '../features/documents/DocumentsRoutes';
import { WhatsAppTemplatesPage } from '../features/whatsapp/WhatsAppTemplatesPage';
import { ReferralsRoutes } from '../features/referrals/ReferralsRoutes';
import { SellersRoutes } from '../features/sellers/SellersRoutes';
import { BookingsRoutes } from '../features/bookings/BookingsRoutes';
import { SiteVisitsRoutes } from '../features/sitevisits/SiteVisitsRoutes';
import { UnitsRoutes } from '../features/units/UnitsRoutes';
import { EnquiriesRoutes } from '../features/enquiries/EnquiriesRoutes';
import { FollowUpsPage } from '../features/followups/FollowUpsPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { MastersPage } from '../features/masters/MastersPage';
import { WorkflowPage } from '../features/workflow/WorkflowPage';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AppShell } from './AppShell';
import { AppProviders } from './AppProviders';
import { MODULES } from './modules';

// Dev-only route: the import is dead code in production builds.
const ComponentsPreviewPage = import.meta.env.DEV ? lazy(() => import('../pages/ComponentsPreviewPage').then((m) => ({ default: m.ComponentsPreviewPage }))) : null;

// Modules whose real page has shipped; the rest render ComingSoonPage until their phase.
const PAGES = { dashboard: DashboardPage, reports: ReportsPage, users: UsersPage, roles: RolesPage, branches: BranchesPage, company: CompanySettingsPage, masters: MastersPage, workflow: WorkflowPage, clients: ClientsRoutes, enquiries: EnquiriesRoutes, followups: FollowUpsPage, units: UnitsRoutes, sitevisits: SiteVisitsRoutes, bookings: BookingsRoutes, referrals: ReferralsRoutes, sellers: SellersRoutes, documents: DocumentsRoutes, whatsapp: WhatsAppTemplatesPage, notifications: NotificationsPage };

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          {MODULES.map((m) => {
            const Page = PAGES[m.key];
            return (
              <Route
                key={m.key}
                path={`${m.path}/*`}
                element={<PermissionRoute permission={m.permission}>{Page ? <Page /> : <ComingSoonPage module={m} />}</PermissionRoute>}
              />
            );
          })}
          {ComponentsPreviewPage && (
            <Route
              path="/dev/components"
              element={
                <Suspense fallback={<Skeleton height={200} />}>
                  <ComponentsPreviewPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
