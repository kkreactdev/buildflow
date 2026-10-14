import { useBranding } from '../../hooks/useBranding';
import { useTheme } from '../../hooks/useTheme';
import './brand.css';

/**
 * The company's logo — the single place branding markup exists.
 *
 * One `<img>` per call site, with the light/dark asset chosen in JS from the resolved theme. That is
 * deliberately simpler than swapping two `<img>`s in CSS: a CSS swap has to out-specify every state
 * rule that hides a variant (the sidebar's collapsed rules did exactly that, and lost). Choosing the
 * `src` here means there is only ever one element, so "both variants visible at once" is impossible by
 * construction, and `useTheme()` already resolves `prefers-color-scheme` for the `system` mode.
 *
 * `className` is for the caller's own layout (`.sidebar-logo`, `.login-logo`); `brand-*` classes carry
 * the shared behaviour. `alt` is the company's real name, not "image".
 */
export function CompanyBrand({ variant = 'logo', className = '' }) {
  const { displayName, logoUrl, logoDarkUrl, markUrl, markDarkUrl } = useBranding();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const src = variant === 'mark' ? (dark ? markDarkUrl : markUrl) : (dark ? logoDarkUrl : logoUrl);
  return <img className={`brand ${variant === 'mark' ? 'brand-mark' : 'brand-logo'} ${className}`.trim()} src={src} alt={displayName} />;
}

/** The company's name, with the same fallback the logo uses. */
export function CompanyName({ className = '' }) {
  const { displayName } = useBranding();
  return <span className={className.trim()}>{displayName}</span>;
}