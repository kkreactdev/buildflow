import { Pill } from '../../components/ui/Pill';
import { PROGRESS, STATE } from './labels';

const pill = (map, key) => {
  const m = map[key] ?? { label: key, color: '#64748b' };
  return <Pill label={m.label} size="sm" dot color={m.color} bg={`color-mix(in srgb, ${m.color} 14%, transparent)`} />;
};
export const ProgressPill = ({ progress }) => pill(PROGRESS, progress);
export const StatePill = ({ state }) => pill(STATE, state);
