import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDocuments } from '../../api/documents';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePermissions } from '../../hooks/usePermissions';
import { formatDateTime } from '../../lib/format';
import { UploadDocumentDialog } from './DocumentDialogs';
import { sizeLabel } from './entityLinks';
import { useDocumentActions } from './useDocumentActions';
import './documents.css';
import '../followups/followups.css';

/**
 * The documents of ONE record, for its detail page. Whatever the server returns is what the user may see; `canAdd` is false
 * for archived records. Loading, empty, error and permission-denied states are all explicit.
 */
export function DocumentsPanel({ entityType, entityId, canAdd = true }) {
  const { can } = usePermissions();
  const canView = can('documents.view');
  const query = useDocuments({ entityType, entityId, limit: 50, sort: '-createdAt' }, { enabled: canView });
  const actions = useDocumentActions();
  const [adding, setAdding] = useState(false);
  if (!canView) return null;
  const rows = query.data?.rows ?? [];

  return (
    <Card className="detail-card detail-section-full">
      <div className="fu-section-head">
        <h3>Documents</h3>
        {can('documents.upload') && canAdd && <Button variant="secondary" onClick={() => setAdding(true)}>Add document</Button>}
      </div>
      {query.isPending ? (
        <p className="muted">Loading documents…</p>
      ) : query.isError ? (
        <EmptyState title={query.error.status === 403 || query.error.status === 404 ? 'Documents are not available to you' : 'Could not load documents'} description={query.error.message} />
      ) : rows.length === 0 ? (
        <EmptyState title="No documents yet" description={can('documents.upload') && canAdd ? 'Attach ID proofs, agreements and other papers here.' : undefined} />
      ) : (
        <div aria-label="Documents">
          {rows.map((d) => (
            <div key={d.id} className="doc-row">
              <div>
                <Link to={`/documents/${d.id}`}><strong>{d.name}</strong></Link> <span className="id-chip">{d.documentNo}</span>
                <div className="doc-meta">
                  {d.type ? (d.type.isActive === false ? `${d.type.label} (inactive)` : d.type.label) : 'Document'} · {d.file.originalName} · {sizeLabel(d.file.bytes)}
                  {d.versionCount > 1 ? ` · version ${d.file.version}` : ''} · {formatDateTime(d.createdAt)}{d.file.uploadedByName ? ` · ${d.file.uploadedByName}` : ''}
                </div>
              </div>
              <ActionMenu items={actions.menuItems(d)} />
            </div>
          ))}
        </div>
      )}
      {adding && <UploadDocumentDialog entityType={entityType} entityId={entityId} onClose={() => setAdding(false)} />}
      {actions.element}
    </Card>
  );
}
