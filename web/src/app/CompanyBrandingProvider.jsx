import { useMemo } from 'react';
import { useCompanyBranding } from '../api/company';
import { BrandingContext } from './brandingContext';

/** The bundled BuildFlow assets, used until an administrator saves a company profile. */
const FALLBACK = {
  displayName: 'BuildFlow',
  logo: '/brand/buildflow-logo.png',
  logoDark: '/brand/buildflow-logo-dark.png',
  mark: '/brand/buildflow-mark.png',
  markDark: '/brand/buildflow-mark-dark.png',
};

/**
 * The ONE source of company branding for the whole app.
 *
 * It sits above authentication on purpose: the login page renders the company name and logo before
 * anyone signs in, which the public `/company/branding` endpoint makes possible. Saving a profile
 * invalidates the query, so every consumer (sidebar, topbar, login) updates in place — no rebuild,
 * no sign-out, no reload.
 *
 * Fallbacks are deliberate rather than incidental: an unconfigured install still shows the bundled
 * BuildFlow artwork, and a failure to load the endpoint degrades to that same artwork instead of an
 * empty sidebar.
 */
export function CompanyBrandingProvider({ children }) {
  const query = useCompanyBranding();
  const data = query.data;

  const value = useMemo(
    () => ({
      displayName: data?.displayName || FALLBACK.displayName,
      logoUrl: data?.logo || FALLBACK.logo,
      logoDarkUrl: data?.logoDark || data?.logo || FALLBACK.logoDark,
      markUrl: data?.mark || FALLBACK.mark,
      markDarkUrl: data?.markDark || data?.mark || FALLBACK.markDark,
      /** True once a real profile has been saved, so a screen can hide "add your logo" prompts. */
      isConfigured: Boolean(data?.displayName),
      isLoading: query.isPending,
      isError: query.isError,
      refetch: query.refetch,
    }),
    [data, query.isPending, query.isError, query.refetch],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}