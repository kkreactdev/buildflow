import { Pill } from '../../components/ui/Pill';

/** The referral type comes from the REFERRAL_TYPE master (inactive values are marked, history stays readable). */
export function TypePill({ type }) {
  if (!type) return <span className="muted">—</span>;
  return <Pill label={type.isActive === false ? `${type.label} (inactive)` : type.label} size="sm" />;
}
