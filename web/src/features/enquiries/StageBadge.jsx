import { Pill } from '../../components/ui/Pill';

/** Stage name and colour come from the workflow configuration returned by the API (never hard-coded). */
export function StageBadge({ stage, size = 'sm' }) {
  if (!stage) return <span className="muted">—</span>;
  const color = stage.color ?? undefined;
  return <Pill label={stage.isActive === false ? `${stage.label} (inactive)` : stage.label} size={size} dot={Boolean(color)} color={color} bg={color ? `${color}22` : undefined} />;
}
