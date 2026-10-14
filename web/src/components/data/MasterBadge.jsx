import { useMasterOptions } from '../../api/masters';
import { statusColor } from '../../lib/statusTones';
import { Pill } from '../ui/Pill';

/**
 * Shows the label (and colour) of a master value by id — including values that
 * were deactivated later, so existing records keep displaying their meaning.
 */
export function MasterBadge({ type, value, size = 'sm' }) {
  const { data } = useMasterOptions([type], { includeInactive: true });
  if (!value) return <span className="muted">—</span>;
  const m = data?.[type]?.find((x) => x._id === value);
  if (!m) return <span className="muted">…</span>;
  const color = type.endsWith('_STATUS') ? statusColor(m.systemKey, m.color) : m.color; // states share one colour everywhere
  return <Pill label={m.label} size={size} dot={Boolean(color)} color={color ?? undefined} bg={color ? `color-mix(in srgb, ${color} 14%, transparent)` : undefined} />;
}
