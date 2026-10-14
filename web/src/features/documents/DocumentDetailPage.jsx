import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTimeline } from '../../api/clients';
import { openDocument, useDocument } from '../../api/documents';
import { api } from '../../api/http';
import { QueryState } from '../../components/data/QueryState';
import { Timeline } from '../../components/data/Timeline';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pill } from '../../components/ui/Pill';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { formatDateTime } from '../../lib/format';
import { entityPath, sizeLabel } from './entityLinks';
import { useDocumentActions } from './useDocumentActions';
import '../clients/clients.css';
import '../enquiries/enquiries.css';

function AuditList({ id }) {
  const q = useQuery({ queryKey: ['audit', 'document', id], queryFn: () => api.list('audit', { query: { entityType: 'document', entityId: id, limit: 50 } }), retry: false });
  if (q.isPending) return null;
  if (q.isError) return <EmptyState title="Audit history unavailable" description={q.error.message} />;
  if (q.data.rows.length === 0) return <EmptyState title="No audit entries" />;
  return (
    <ul className="history-list">
      {q.data.rows.map((a) => (
        <li key={a.id}>
          <strong>{a.action}</strong> · {formatDateTime(a.at)}
        </li>
      ))}
    </ul>
  );
}

function DocumentDetail({ document: d }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = usePermissions();
  const actions = useDocumentActions({ onArchived: () => navigate('/documents') });
  const timeline = useTimeline('document', can('activities.view') ? d.id : null);
  const link = entityPath(d.entityType, d.entityId);
  const open = async (version) => {
    try {
      await openDocument(d.id, version);
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to="/documents" className="muted">← Documents</Link>
          <h2>{d.name} {d.isArchived && <Pill label="Archived" size="sm" />}</h2>
          <span className="id-chip">{d.documentNo}</span>
        </div>
        <div className="detail-actions">
          {d.allowed.download && <Button onClick={() => open()}>Open file</Button>}
          <ActionMenu items={actions.menuItems(d).filter((i) => i.label !== 'Open')} />
        </div>
      </div>
      <div className="detail-grid">
        <Card className="detail-card">
          <h3>Document</h3>
          <dl className="kv">
            <dt>Type</dt><dd>{d.type ? (d.type.isActive === false ? `${d.type.label} (inactive)` : d.type.label) : '—'}</dd>
            <dt>Attached to</dt><dd>{link ? <Link to={link}>{d.entityTypeLabel} {d.entityNo}</Link> : `${d.entityTypeLabel} ${d.entityNo}`}</dd>
            <dt>Branch</dt><dd>{d.branch?.name ?? '—'}</dd>
            <dt>File</dt><dd>{d.file.originalName} · {sizeLabel(d.file.bytes)} · {d.file.format.toUpperCase()}</dd>
            <dt>Added</dt><dd>{formatDateTime(d.createdAt)}</dd>
            <dt>Notes</dt><dd>{d.notes ?? '—'}</dd>
          </dl>
        </Card>
        <Card className="detail-card">
          <h3>Versions</h3>
          <ul className="history-list" aria-label="Versions">
            <li>
              <strong>Version {d.file.version} (current)</strong> · {d.file.originalName}
              <div className="muted">{formatDateTime(d.file.uploadedAt)}{d.file.uploadedByName ? ` · ${d.file.uploadedByName}` : ''}</div>
            </li>
            {[...(d.previousFiles ?? [])].reverse().map((f) => (
              <li key={f.version}>
                <strong>Version {f.version}</strong> · {f.originalName}{d.allowed.download && <> · <button type="button" className="btn btn-ghost" onClick={() => open(f.version)}>Open</button></>}
                <div className="muted">{formatDateTime(f.uploadedAt)}{f.uploadedByName ? ` · ${f.uploadedByName}` : ''} · replaced {formatDateTime(f.replacedAt)}</div>
              </li>
            ))}
          </ul>
        </Card>
        {can('activities.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this document will appear here." />
          </Card>
        )}
        {can('audit.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Audit history</h3>
            <AuditList id={d.id} />
          </Card>
        )}
      </div>
      {actions.element}
    </div>
  );
}

export function DocumentDetailPage() {
  const { id } = useParams();
  const query = useDocument(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Document not found' }}>
      {(document) => <DocumentDetail document={document} />}
    </QueryState>
  );
}
