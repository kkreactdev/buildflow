import { DocumentsPanel } from '../documents/DocumentsPanel';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTimeline } from '../../api/clients';
import { api } from '../../api/http';
import { useSiteVisit } from '../../api/sitevisits';
import { QueryState } from '../../components/data/QueryState';
import { Timeline } from '../../components/data/Timeline';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pill } from '../../components/ui/Pill';
import { usePermissions } from '../../hooks/usePermissions';
import { formatDateTime } from '../../lib/format';
import { formatWhen } from '../followups/datetime';
import { useVisitActions } from './useVisitActions';
import { VisitStatusPill } from './VisitStatusPill';
import '../clients/clients.css';
import '../enquiries/enquiries.css';
import './sitevisits.css';

function AuditList({ id }) {
  const q = useQuery({ queryKey: ['audit', 'sitevisit', id], queryFn: () => api.list('audit', { query: { entityType: 'sitevisit', entityId: id, limit: 50 } }), retry: false });
  if (q.isPending) return null;
  if (q.isError) return <EmptyState title="Audit history unavailable" description={q.error.message} />;
  if (q.data.rows.length === 0) return <EmptyState title="No audit entries" />;
  return (
    <ul className="history-list">
      {q.data.rows.map((a) => (
        <li key={a.id}>
          <strong>{a.action}</strong> · {formatDateTime(a.at)}
          {a.reason && <> · “{a.reason}”</>}
          <div className="muted">{Object.entries(a.changes ?? {}).map(([f, c]) => `${f}: ${c.from ?? '∅'} → ${c.to ?? '∅'}`).join('; ')}</div>
        </li>
      ))}
    </ul>
  );
}

function VisitDetail({ visit }) {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const actions = useVisitActions({ onArchived: () => navigate('/site-visits') });
  const canTimeline = can('activities.view');
  const timeline = useTimeline('sitevisit', canTimeline ? visit.id : null);
  const a = visit.allowed;
  const hasCoords = visit.latitude != null && visit.longitude != null;
  const done = visit.statusKey === 'COMPLETED';

  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to="/site-visits" className="muted">← Site Visits</Link>
          <h2>{visit.name} {visit.isArchived && <Pill label="Archived" size="sm" />}</h2>
          <span className="id-chip">{visit.visitNo}</span> <VisitStatusPill visit={visit} />
        </div>
        <div className="detail-actions">
          {a.complete && <Button onClick={() => actions.menuItems(visit)[0].onSelect()}>Complete…</Button>}
          <ActionMenu items={actions.menuItems(visit).filter((i) => i.label !== 'Complete…')} />
        </div>
      </div>

      <div className="detail-grid">
        <Card className="detail-card">
          <h3>Visit</h3>
          <dl className="kv">
            <dt>Visit ID</dt><dd className="id-chip">{visit.visitNo}</dd>
            <dt>Status</dt><dd><VisitStatusPill visit={visit} /></dd>
            <dt>Scheduled for</dt><dd>{formatWhen(visit.scheduledAt)}</dd>
            <dt>Branch</dt><dd>{visit.branch?.name ?? '—'}</dd>
            <dt>Enquiry</dt><dd><Link to={`/enquiries/${visit.enquiryId}`}>{visit.enquiryNo}</Link></dd>
            <dt>Person</dt><dd>{visit.name} · <a href={`tel:${visit.phoneE164}`}>{visit.phone}</a></dd>
            {visit.clientNo && <><dt>Client</dt><dd><Link to={`/clients/${visit.clientId}`}>{visit.clientNo}</Link></dd></>}
            <dt>Location</dt>
            <dd>{hasCoords ? <a href={`https://www.google.com/maps?q=${visit.latitude},${visit.longitude}`} target="_blank" rel="noreferrer">{visit.latitude}, {visit.longitude}</a> : '—'}</dd>
            <dt>Notes</dt><dd>{visit.notes ?? '—'}</dd>
          </dl>
        </Card>

        <Card className="detail-card">
          <h3>Units</h3>
          {visit.units.length === 0 ? (
            <EmptyState title="No units selected" />
          ) : (
            <ul className="history-list" aria-label="Units">
              {visit.units.map((u) => (
                <li key={u.id}>
                  {u.name !== undefined ? <Link to={`/units/${u.id}`}><strong>{u.unitCode}</strong></Link> : <strong>{u.unitCode}</strong>}
                  {u.name && <> · {u.name}</>}
                  {u.isArchived && <> · <span className="muted">archived</span></>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {(done || visit.statusKey === 'CANCELLED') && (
          <Card className="detail-card">
            <h3>{done ? 'Outcome' : 'Cancellation'}</h3>
            {done ? (
              <dl className="kv">
                <dt>Completed</dt><dd>{formatDateTime(visit.completedAt)}</dd>
                <dt>Feedback</dt><dd>{visit.feedback}</dd>
                <dt>Notes</dt><dd>{visit.completionNotes ?? '—'}</dd>
                <dt>Follow-up</dt>
                <dd>{visit.followUp ? <>Scheduled for {formatWhen(visit.followUp.scheduledAt)} · <Link to={`/enquiries/${visit.enquiryId}`}>view on enquiry</Link></> : 'Created automatically'}</dd>
              </dl>
            ) : (
              <dl className="kv">
                <dt>Cancelled</dt><dd>{formatDateTime(visit.cancelledAt)}</dd>
                <dt>Reason</dt><dd>{visit.cancelReason}</dd>
              </dl>
            )}
          </Card>
        )}

        <Card className="detail-card">
          <h3>Assignment</h3>
          <dl className="kv"><dt>Visit by</dt><dd>{visit.assignedToName ?? '—'}</dd></dl>
          <ul className="history-list" aria-label="Assignment history">
            {[...visit.assignments].reverse().map((x) => (
              <li key={x.id}>
                {x.fromName ? `${x.fromName} → ` : ''}<strong>{x.toName ?? 'User'}</strong>
                <div className="muted">{formatDateTime(x.at)}{x.byName ? ` · by ${x.byName}` : ''}{x.reason ? ` · “${x.reason}”` : ''}</div>
              </li>
            ))}
          </ul>
        </Card>

        <DocumentsPanel entityType="sitevisit" entityId={visit.id} canAdd={!visit.isArchived} />
        {canTimeline && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this visit will appear here." />
          </Card>
        )}
        {can('audit.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Audit history</h3>
            <AuditList id={visit.id} />
          </Card>
        )}
      </div>
      {actions.element}
    </div>
  );
}

export function SiteVisitDetailPage() {
  const { id } = useParams();
  const query = useSiteVisit(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Site visit not found' }}>
      {(visit) => <VisitDetail visit={visit} />}
    </QueryState>
  );
}
