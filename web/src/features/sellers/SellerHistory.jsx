import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusPill } from '../../components/ui/StatusPill';
import { formatDateTime } from '../../lib/format';
import '../../components/data/Timeline.css';

/**
 * The immutable status history of a seller or proposed property, oldest first: the value of a history is the
 * sequence. Each row names the move, the states either side, who made it, when (server time) and why, and links
 * to the other records the move touched (the Unit created at purchase, for example).
 */
const ACTION_LABELS = {
  registered: 'Registered',
  status: 'Status changed',
  verified: 'Verification recorded',
  negotiation: 'Price negotiation started',
  approved: 'Approved for purchase',
  purchased: 'Purchase completed',
  workStarted: 'Development started',
  readyToSell: 'Released to buyers',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

const REF_LINKS = {
  unit: (id) => ({ to: `/units/${id}`, label: 'Unit' }),
  seller: (id) => ({ to: `/sellers/${id}`, label: 'Seller' }),
  sellerProperty: (id) => ({ to: `/sellers/properties/${id}`, label: 'Property' }),
};

function Pill({ statusKey, status }) {
  return <StatusPill statusKey={statusKey} label={status?.label ?? statusKey} color={status?.color} />;
}

export function SellerHistory({ history = [], emptyDescription = 'Nothing has happened here yet.', hideRefs = [] }) {
  if (history.length === 0) return <EmptyState title="No history yet" description={emptyDescription} />;
  return (
    <ol className="timeline" aria-label="Status history">
      {history.map((h) => {
        const links = (h.refs ?? []).filter((r) => REF_LINKS[r.type] && !hideRefs.includes(r.type)).map((r) => ({ key: `${r.type}-${r.id}`, ...REF_LINKS[r.type](r.id) }));
        return (
          <li key={h.id} className="timeline-item">
            <span className="timeline-dot" />
            <div>
              <div className="timeline-title">
                {ACTION_LABELS[h.action] ?? h.action}
                {' — '}
                {h.fromStatus && h.fromStatus !== h.toStatus ? (
                  <>
                    <Pill statusKey={h.fromStatus} status={h.from} />{' → '}
                  </>
                ) : null}
                <Pill statusKey={h.toStatus} status={h.to} />
              </div>
              {h.reason && <div className="timeline-note">{h.reason}</div>}
              {h.notes && h.notes !== h.reason && <div className="timeline-note muted">{h.notes}</div>}
              <div className="timeline-meta">
                {formatDateTime(h.at)}
                {h.byName ? ` · ${h.byName}` : ''}
                {links.map((l) => (
                  <Link key={l.key} to={l.to}>{l.label}</Link>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
