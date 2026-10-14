import { StatusPill } from '../../components/ui/StatusPill';

/** Label comes from the SITEVISIT_STATUS master; well-known states use the shared status colours. */
export function VisitStatusPill({ visit }) {
  const s = visit.status;
  return <StatusPill statusKey={visit.statusKey} label={s?.label} color={s?.color} />;
}
