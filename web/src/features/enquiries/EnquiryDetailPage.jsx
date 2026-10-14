import { DocumentsPanel } from '../documents/DocumentsPanel';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEnquiry, useEnquiryMutations } from '../../api/enquiries';
import { useTimeline } from '../../api/clients';
import { api } from '../../api/http';
import { useQuery } from '@tanstack/react-query';
import { QueryState } from '../../components/data/QueryState';
import { Timeline } from '../../components/data/Timeline';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pill } from '../../components/ui/Pill';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { formatDateTime } from '../../lib/format';
import { UnitsSection } from '../relations/UnitsSection';
import { AssignDialog } from './AssignDialog';
import { ConvertDialog } from './ConvertDialog';
import { EnquiryEditModal } from './EnquiryFormModal';
import { MoveToDialog } from './MoveToDialog';
import { EnquiryReferralCard } from '../referrals/EnquiryReferralCard';
import { SiteVisitsSection } from '../sitevisits/SiteVisitsSection';
import { FollowUpsSection } from '../followups/FollowUpsSection';
import { StageBadge } from './StageBadge';
import { useStageMover } from './useStageMover';
import '../clients/clients.css';
import './enquiries.css';

const val = (m) => (m ? (m.isActive === false ? `${m.label} (inactive)` : m.label) : '—');

function AuditList({ id }) {
  const q = useQuery({ queryKey: ['audit', 'enquiry', id], queryFn: () => api.list('audit', { query: { entityType: 'enquiry', entityId: id, limit: 50 } }), retry: false });
  if (q.isPending) return null;
  if (q.isError) return <EmptyState title="Audit history unavailable" description={q.error.message} />;
  if (q.data.rows.length === 0) return <EmptyState title="No audit entries" />;
  return (
    <ul className="history-list">
      {q.data.rows.map((a) => (
        <li key={a.id}>
          <strong>{a.action}</strong> · {formatDateTime(a.at)}
          {a.reason && <> · “{a.reason}”</>}
          <div className="muted">
            {Object.entries(a.changes ?? {}).map(([f, c]) => `${f}: ${c.from ?? '∅'} → ${c.to ?? '∅'}`).join('; ')}
          </div>
        </li>
      ))}
    </ul>
  );
}

function EnquiryDetail({ enquiry }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = usePermissions();
  const { archive } = useEnquiryMutations();
  const mover = useStageMover();
  const canTimeline = can('activities.view');
  const timeline = useTimeline('enquiry', canTimeline ? enquiry.id : null);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [moving, setMoving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [converting, setConverting] = useState(false);
  const lost = enquiry.stage.kind === 'LOST';
  const open = !enquiry.isArchived;
  const hasMoves = enquiry.transitions.length > 0;
  const conversion = enquiry.conversion;
  const converted = Boolean(conversion?.alreadyConverted);
  // Shown to people who may convert; enabled only when the server says this enquiry is eligible now (booked, open, in scope).
  const showConvert = open && !lost && !converted && can('enquiries.convert') && can('clients.create') && Boolean(conversion?.stageKey);

  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to="/enquiries" className="muted">← Enquiries</Link>
          <h2>{enquiry.name} {enquiry.isArchived && <Pill label="Archived" size="sm" />}</h2>
          <span className="id-chip">{enquiry.enquiryNo}</span>
        </div>
        <div className="detail-actions">
          {showConvert && (
            <Button onClick={() => setConverting(true)} disabled={!conversion.eligible} title={conversion.eligible ? 'Create the client from this enquiry' : 'Available once the enquiry has been booked'}>
              Convert to Client
            </Button>
          )}
          {converted && conversion.client && <Link to={`/clients/${conversion.client.id}`} className="btn btn-secondary">View client {conversion.client.clientNo}</Link>}
          {open && hasMoves && <Button onClick={() => setMoving(true)}>{lost ? 'Reopen…' : 'Change status…'}</Button>}
          {open && can('enquiries.assign') && <Button variant="secondary" onClick={() => setAssigning(true)}>{enquiry.assignedTo ? 'Reassign' : 'Assign'}</Button>}
          {open && can('enquiries.edit') && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          {open && can('enquiries.archive') && <ActionMenu items={[{ label: 'Archive', danger: true, onSelect: () => setArchiving(true) }]} />}
        </div>
      </div>

      <div className="detail-grid detail-grid--info">
        <Card className="detail-card detail-card--enquiry">
          <h3>Enquiry</h3>
          <dl className="kv">
            <dt>Enquiry ID</dt><dd className="id-chip">{enquiry.enquiryNo}</dd>
            <dt>Current stage</dt><dd><StageBadge stage={enquiry.stage} /></dd>
            {lost && <><dt>Lost reason</dt><dd>{val(enquiry.lostReason)}</dd></>}
            <dt>In stage since</dt><dd>{formatDateTime(enquiry.stageChangedAt)}</dd>
            <dt>Branch</dt><dd>{enquiry.branch?.name ?? '—'}</dd>
            <dt>Source</dt><dd>{val(enquiry.source)}</dd>
            <dt>Type</dt><dd>{val(enquiry.type)}</dd>
            <dt>Created</dt><dd>{formatDateTime(enquiry.createdAt)}</dd>
            <dt>Notes</dt><dd>{enquiry.notes ?? '—'}</dd>
          </dl>
          {/* Person details live inside the Enquiry card rather than as a card of their own: they are
              the same record's contact details, and a separate card left a mostly-empty panel beside
              this one. A subheading keeps the two groups distinguishable. */}
          <h4 className="detail-subhead">Person</h4>
          <dl className="kv">
            <dt>Name</dt><dd>{enquiry.person?.name ?? enquiry.name}</dd>
            <dt>Phone</dt><dd><a href={`tel:${enquiry.phoneE164}`}>{enquiry.person?.phone ?? enquiry.phone}</a></dd>
            <dt>Email</dt><dd>{enquiry.person?.email ?? '—'}</dd>
            <dt>Address</dt><dd>{enquiry.person?.address ?? '—'}</dd>
          </dl>
        </Card>

        {/* The right-hand column: Client above, Assignment below, each the full width of the column. */}
        <div className="detail-side">
          {converted && (
            <Card className="detail-card detail-card--client" aria-label="Client">
              <h3>Client</h3>
              {conversion.client
                ? <dl className="kv"><dt>Converted to</dt><dd><Link to={`/clients/${conversion.client.id}`}><span className="id-chip">{conversion.client.clientNo}</span> {conversion.client.name}</Link></dd></dl>
                : <p className="muted">This enquiry is converted. The client record is not available to you.</p>}
            </Card>
          )}
          <Card className="detail-card detail-card--assignment">
            <h3>Assignment</h3>
            <dl className="kv"><dt>Assigned to</dt><dd>{enquiry.assignedToName ?? 'Unassigned'}</dd></dl>
            {enquiry.assignments.length === 0 ? (
              <p className="muted">No assignment history yet.</p>
            ) : (
              <ul className="history-list" aria-label="Assignment history">
                {[...enquiry.assignments].reverse().map((a) => (
                  <li key={a.id}>
                    {a.fromName ? `${a.fromName} → ` : ''}<strong>{a.toName ?? 'User'}</strong>
                    <div className="muted">{formatDateTime(a.at)}{a.byName ? ` · by ${a.byName}` : ''}{a.reason ? ` · “${a.reason}”` : ''}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <EnquiryReferralCard enquiry={enquiry} canLink={open} />
        </div>

        {open && <FollowUpsSection anchor={{ enquiryId: enquiry.id }} branchId={enquiry.branchId} />}
        <SiteVisitsSection enquiry={enquiry} canSchedule={open && !lost} />
        <UnitsSection rows={enquiry.units === undefined ? [] : enquiry.units} enquiries={[{ id: enquiry.id, enquiryNo: enquiry.enquiryNo, name: enquiry.name, branchId: enquiry.branchId, stage: enquiry.stage, isArchived: enquiry.isArchived }]} />

        <Card className="detail-card detail-section-full">
          <h3>Stage history</h3>
          <ul className="history-list" aria-label="Stage history">
            {[...enquiry.stageHistory].reverse().map((h) => (
              <li key={h.id}>
                {h.fromLabel ? <>{h.fromLabel} → <strong>{h.toLabel}</strong></> : <>Created as <strong>{h.toLabel}</strong></>}
                {h.lostReason && <> · {h.lostReason.label}</>}
                <div className="muted">{formatDateTime(h.at)}{h.byName ? ` · by ${h.byName}` : ''}{h.reason ? ` · “${h.reason}”` : ''}</div>
              </li>
            ))}
          </ul>
        </Card>

        <DocumentsPanel entityType="enquiry" entityId={enquiry.id} canAdd={open} />
        {canTimeline && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this enquiry will appear here." />
          </Card>
        )}
        {can('audit.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Audit history</h3>
            <AuditList id={enquiry.id} />
          </Card>
        )}
      </div>

      {editing && <EnquiryEditModal enquiry={enquiry} onClose={() => setEditing(false)} />}
      {assigning && <AssignDialog enquiry={enquiry} onClose={() => setAssigning(false)} />}
      {moving && <MoveToDialog enquiry={enquiry} onClose={() => setMoving(false)} onPick={(t) => { setMoving(false); mover.requestMove(enquiry, t); }} />}
      {mover.dialog}
      {converting && <ConvertDialog enquiry={enquiry} onClose={() => setConverting(false)} />}
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={`Archive ${enquiry.enquiryNo}?`}
        description="The enquiry disappears from lists and the board, but its history is kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(enquiry.id);
          toast.success('Enquiry archived');
          navigate('/enquiries');
        }}
      />
    </div>
  );
}

export function EnquiryDetailPage() {
  const { id } = useParams();
  const query = useEnquiry(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Enquiry not found' }}>
      {(enquiry) => <EnquiryDetail enquiry={enquiry} />}
    </QueryState>
  );
}
