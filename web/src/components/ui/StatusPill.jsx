import { statusColor } from '../../lib/statusTones';
import { Pill } from './Pill';

/** The single badge for a record state. `statusKey` picks the shared semantic colour; custom master statuses use `color`. */
export function StatusPill({ statusKey, label, color, size = 'sm' }) {
  const c = statusColor(statusKey, color);
  return <Pill label={label ?? statusKey} size={size} dot={Boolean(c)} color={c} bg={c ? `color-mix(in srgb, ${c} 14%, transparent)` : undefined} />;
}
