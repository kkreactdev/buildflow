import { useContext } from 'react';
import { BrandingContext } from '../app/brandingContext';

/** The saved company branding. Falls back to the bundled BuildFlow assets when none is configured. */
export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within CompanyBrandingProvider');
  return ctx;
}