import { StatusPill } from '../../components/ui/StatusPill';

/** Label comes from the UNIT_STATUS master (renaming needs no code change); well-known states use the shared status colours. */
export function UnitStatusPill({ unit }) {
  const s = unit.status;
  return <StatusPill statusKey={unit.statusKey} label={s?.label} color={s?.color} />;
}
