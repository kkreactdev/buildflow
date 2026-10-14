import { ToastProvider } from '../components/ui/ToastProvider';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { AuthProvider } from './AuthProvider';
import { CompanyBrandingProvider } from './CompanyBrandingProvider';
import { BranchScopeProvider } from './BranchScope';
import { QueryProvider } from './QueryProvider';
import { ThemeProvider } from './ThemeProvider';

/** Provider stack in one place (also used by tests). Router is mounted by the caller. */
export function AppProviders({ children, initialSession }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        {/* Branding sits inside QueryProvider (it fetches) but ABOVE AuthProvider: it is public data and
            the login page must render the company name and logo before there is a session. */}
        <CompanyBrandingProvider>
          <ToastProvider>
            <AuthProvider initialSession={initialSession}>
              <BranchScopeProvider>
                <ErrorBoundary>{children}</ErrorBoundary>
              </BranchScopeProvider>
            </AuthProvider>
          </ToastProvider>
        </CompanyBrandingProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}