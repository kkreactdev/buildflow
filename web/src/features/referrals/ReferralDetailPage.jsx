import { DocumentsPanel } from '../documents/DocumentsPanel';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTimeline } from '../../api/clients';
import { api } from '../../api/http';
import { useReferral, useReferralMutations } from '../../api/referrals';
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
import { LinkEnquiryDialog, ReferralAssignDialog, ReferralEditDialog, UnlinkEnquiryDialog } from './ReferralDialogs';
import { TypePill } from './TypePill';
import '../clients/clients.css';
import '../enquiries/enquiries.css';

function AuditList({ id }) {
  const q = useQuery({ queryKey: ['audit', 'referral', id], queryFn: () => api.list('audit', { query: { entityType: 'referral', entityId: id, limit: 50 } }), retry: false });
  if (q.isPending) return null;
  if (q.isError) return <EmptyState title="Audit history unavailable" description={q.error.message} />;
  if (q.data.rows.length === 0) return <EmptyState title="No audit entries" />;
  return (
    <ul className="history-list">
      {q.data.rows.map((a) => (
        <li key={a.id}>
          <strong>{a.action}</strong> · {formatDateTime(a.at)}
          {a.reason && <> · “{a.reason}”</>}
        </li>
      ))}
    </ul>
  );
}

function ReferralDetail({ referral }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = usePermissions();
  const { archive } = useReferralMutations();
  const timeline = useTimeline('referral', can('activities.view') ? referral.id : null);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const a = referral.allowed;
  const person = referral.person;

  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to="/referrals" className="muted">← Referrals</Link>
          <h2>{referral.name} {referral.isArchived && <Pill label="Archived" size="sm" />}</h2>
          <span className="id-chip">{referral.referralNo}</span> <TypePill type={referral.type} />
        </div>
        <div className="detail-actions">
          {a.assign && <Button variant="secondary" onClick={() => setAssigning(true)}>{referral.assignedTo ? 'Reassign' : 'Assign'}</Button>}
          {a.link && <Button variant="secondary" onClick={() => setLinking(true)}>Link enquiry</Button>}
          {a.edit && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          {a.archive && <ActionMenu items={[{ label: 'Archive', danger: true, onSelect: () => setArchiving(true) }]} />}
        </div>
      </div>
      <div className="detail-grid">
        <Card className="detail-card">
          <h3>Identity</h3>
          <dl className="kv">
            <dt>Name</dt><dd>{person?.name ?? referral.name}</dd>
            <dt>Phone</dt><dd><a href={`tel:${referral.phoneE164}`}>{person?.phone ?? referral.phone}</a></dd>
            <dt>Email</dt><dd>{person?.email ?? '—'}</dd>
            <dt>Address</dt><dd>{person?.address ?? '—'}</dd>
          </dl>
        </Card>
        <Card className="detail-card">
          <h3>Referral</h3>
          <dl className="kv">
            <dt>Referral ID</dt><dd className="id-chip">{referral.referralNo}</dd>
            <dt>Type</dt><dd><TypePill type={referral.type} /></dd>
            <dt>Source</dt>
            <dd>
              {referral.sourceClient ? <>Client <Link to={`/clients/${referral.sourceClient.id}`}>{referral.sourceClient.clientNo}</Link></>
                : referral.sourceEmployee ? <>Employee {referral.sourceEmployee.name}</>
                : referral.sourceClientNo ? <>Client {referral.sourceClientNo}</>
                : referral.sourceUserId ? 'Employee' : 'External person'}
            </dd>
            <dt>Branch</dt><dd>{referral.branch?.name ?? '—'}</dd>
            <dt>Assigned to</dt><dd>{referral.assignedToName ?? 'Unassigned'}</dd>
            <dt>Relationship</dt><dd>{referral.reason ?? '—'}</dd>
            <dt>Notes</dt><dd>{referral.notes ?? '—'}</dd>
            <dt>Created</dt><dd>{formatDateTime(referral.createdAt)}</dd>
          </dl>
        </Card>
        <Card className="detail-card">
          <h3>Referred enquiries</h3>
          {referral.enquiries.length === 0 ? (
            <EmptyState title="No enquiries yet" description={a.link ? 'Link the enquiries this referrer brings.' : undefined} />
          ) : (
            <ul className="history-list" aria-label="Referred enquiries">
              {referral.enquiries.map((e) => (
                <li key={e.id}>
                  <Link to={`/enquiries/${e.id}`}><strong>{e.enquiryNo}</strong></Link> · {e.name} · <span className="muted">{e.stageLabel}</span>
                  {a.link && <> · <button type="button" className="btn btn-ghost" onClick={() => setUnlinking(e)}>Unlink</button></>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="detail-card">
          <h3>Assignment</h3>
          {referral.assignments.length === 0 ? (
            <p className="muted">No assignment history yet.</p>
          ) : (
            <ul className="history-list" aria-label="Assignment history">
              {[...referral.assignments].reverse().map((x) => (
                <li key={x.id}>
                  {x.fromName ? `${x.fromName} → ` : ''}<strong>{x.toName ?? 'User'}</strong>
                  <div className="muted">{formatDateTime(x.at)}{x.byName ? ` · by ${x.byName}` : ''}{x.reason ? ` · “${x.reason}”` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <DocumentsPanel entityType="referral" entityId={referral.id} canAdd={!referral.isArchived} />
        {can('activities.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this referral will appear here." />
          </Card>
        )}
        {can('audit.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Audit history</h3>
            <AuditList id={referral.id} />
          </Card>
        )}
      </div>
      {editing && <ReferralEditDialog referral={referral} onClose={() => setEditing(false)} />}
      {assigning && <ReferralAssignDialog referral={referral} onClose={() => setAssigning(false)} />}
      {linking && <LinkEnquiryDialog referral={referral} onClose={() => setLinking(false)} />}
      {unlinking && <UnlinkEnquiryDialog referral={referral} enquiry={unlinking} onClose={() => setUnlinking(null)} />}
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={`Archive ${referral.referralNo}?`}
        description="The referral disappears from lists, but its history and linked enquiries are kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(referral.id);
          toast.success('Referral archived');
          navigate('/referrals');
        }}
      />
    </div>
  );
}

export function ReferralDetailPage() {
  const { id } = useParams();
  const query = useReferral(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Referral not found' }}>
      {(referral) => <ReferralDetail referral={referral} />}
    </QueryState>
  );
}
