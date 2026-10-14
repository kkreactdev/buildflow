import { Link } from 'react-router-dom';
import { StatePill } from './RelationPill';

const SHOWN = 3;

/** The one Units column of the Enquiries and Clients tables: each related unit once, with its relationship badge. */
export function UnitsCell({ units }) {
  if (!units || units.length === 0) return <span className="muted">—</span>;
  const rest = units.slice(SHOWN);
  return (
    <span className="units-cell">
      {units.slice(0, SHOWN).map((u) => (
        <span key={u.unitId} className="units-cell-item" onClick={(e) => e.stopPropagation()}>
          <Link to={`/units/${u.unitId}`} title={u.name ?? u.unitCode}>{u.unitCode}</Link> <StatePill state={u.state} />
        </span>
      ))}
      {rest.length > 0 && <span className="muted" title={rest.map((u) => `${u.unitCode}`).join(', ')}>+{rest.length} more</span>}
    </span>
  );
}
