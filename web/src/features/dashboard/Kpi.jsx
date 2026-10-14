import { Children, Fragment, isValidElement } from 'react';
import { Link } from 'react-router-dom';
import { CountUp } from '../../components/motion/CountUp';
import { Reveal } from '../../components/motion/Reveal';
import { Card } from '../../components/ui/Card';
import { LockIcon } from '../../components/ui/icons';
import { columnsFor } from './layout';
import { deltaText } from './delta';

/**
 * One metric: tone-coloured icon, the exact number, an optional previous-period comparison (only when the API sent one), a
 * definition tooltip, and a link to the matching filtered list. `index` staggers its entrance.
 */
export function Kpi({ label, value, previous, prevLabel, note, definition, to, tone = 'teal', icon: Icon, featured, index = 0 }) {
  // Nothing to compare when both periods are empty: "no change vs 0" would say nothing.
  const delta = value === 0 && previous === 0 ? null : deltaText(value, previous, prevLabel);
  const trend = previous === undefined ? null : value > previous ? 'up' : value < previous ? 'down' : 'flat';
  const body = (
    <>
      <span className="kpi-head">
        <span className="kpi-icon">{Icon && <Icon size={18} />}</span>
        <span className="kpi-label">{label}</span>
      </span>
      <CountUp className="kpi-value" value={value} />
      {(delta || note) && (
        <span className="kpi-meta">
          {delta && <span className={`kpi-delta is-${trend}`}>{trend === 'up' ? '▲ ' : trend === 'down' ? '▼ ' : ''}{delta}</span>}
          {note && <span className="kpi-delta">{note}</span>}
        </span>
      )}
    </>
  );
  return (
    <Reveal index={index}>
      <Card className={`kpi tone-${tone} ${featured ? 'kpi-featured' : ''}`} data-testid={`kpi-${label}`}>
        {to ? <Link to={to} className="kpi-link" aria-label={`${label}: ${value}`}>{body}</Link> : <div className="kpi-link">{body}</div>}
        {definition && <span className="kpi-def" role="note" tabIndex={0} title={definition} aria-label={`About ${label}: ${definition}`}>i</span>}
      </Card>
    </Reveal>
  );
}

export function NoAccess({ what }) {
  return (
    <Card className="kpi kpi-locked" role="note">
      <LockIcon size={18} />
      <span className="dash-muted">You don't have permission to view {what}.</span>
    </Card>
  );
}

/** The one KPI grid used by every dashboard group; the CSS reduces `data-cols` for narrower containers. */
export function KpiGrid({ children }) {
  // Fragments hold several cards each, so count through them.
  const count = (nodes) => Children.toArray(nodes).reduce((n, c) => n + (isValidElement(c) && c.type === Fragment ? count(c.props.children) : 1), 0);
  const n = count(children);
  return <div className="kpi-grid" data-cols={columnsFor(n)}>{children}</div>;
}
