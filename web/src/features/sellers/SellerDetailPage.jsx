import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTimeline } from '../../api/clients';
import { useSeller, useSellerMutations } from '../../api/sellers';
import { QueryState } from '../../components/data/QueryState';
import { Timeline } from '../../components/data/Timeline';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pill } from '../../components/ui/Pill';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { formatDateFull, formatDateTime, formatInr, formatPhone } from '../../lib/format';
import { DocumentsPanel } from '../documents/DocumentsPanel';
import { FollowUpsSection } from '../followups/FollowUpsSection';
import { PropertyCreateModal, SellerAssignDialog, SellerNotesModal, SellerStatusDialog } from './SellerDialogs';
import { SellerHistory } from './SellerHistory';
import { EligibilityPill, PropertyStatusPill, SellerStatusPill } from './SellerPills';
import '../clients/clients.css';
import '../enquiries/enquiries.css';
import './sellers.css';

function SellerDetail({ seller }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = usePermissions();
  const { archive } = useSellerMutations();
  const [dialog, setDialog] = useState(null);
  const allowed = seller.allowed ?? {};
  const canSeeTimeline = can('activities.view');
  const timeline = useTimeline('seller', canSeeTimeline ? seller.id : null); // no request at all without the permission
  const close = () => setDialog(null);

  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to="/sellers" className="muted">← Sellers</Link>
          <h2>{seller.personName} {seller.isArchived && <Pill label="Archived" size="sm" />}</h2>
          <span className="id-chip">{seller.sellerNo}</span>{' '}
          <SellerStatusPill seller={seller} />
        </div>
        <div className="detail-actions">
          {allowed.addProperty && <Button onClick={() => setDialog('property')}>Add property</Button>}
          {allowed.changeStatus && <Button variant="secondary" onClick={() => setDialog('status')}>{seller.statusKey === 'REGISTERED' && allowed.statusTargets?.includes('VERIFIED') ? 'Verify / change status' : 'Change status'}</Button>}
          {allowed.assign && <Button variant="secondary" onClick={() => setDialog('assign')}>{seller.assignedTo ? 'Reassign' : 'Assign'}</Button>}
          {allowed.edit && <Button variant="secondary" onClick={() => setDialog('notes')}>Edit notes</Button>}
          {can('sellers.archive') && !seller.isArchived && (
            <Button variant="danger" onClick={() => setDialog('archive')} disabled={!allowed.archive} title={allowed.archive ? undefined : 'Reject or withdraw the open proposals first'}>Archive</Button>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <Card className="detail-card">
          <h3>Seller</h3>
          <dl className="kv">
            <dt>Name</dt><dd>{seller.personName}</dd>
            <dt>Phone</dt><dd><a href={`tel:${seller.phoneE164}`}>{formatPhone(seller.phoneE164)}</a></dd>
            <dt>Status</dt><dd><SellerStatusPill seller={seller} /> <span className="muted">since {formatDateTime(seller.statusChangedAt)}</span></dd>
            <dt>Handled by</dt><dd>{seller.assignedToName ?? <span className="muted">Unassigned</span>}</dd>
            {seller.branch && <><dt>Branch</dt><dd>{seller.branch.name}</dd></>}
            <dt>Registered</dt><dd>{formatDateFull(seller.createdAt)}</dd>
            <dt>Notes</dt><dd>{seller.notes ?? '—'}</dd>
          </dl>
          {seller.statusKey !== 'VERIFIED' && !seller.isArchived && (
            <p className="muted">The seller must be verified before any of their properties can be approved or bought.</p>
          )}
        </Card>

        <Card className="detail-card detail-section-full">
          <h3>Proposed properties ({seller.properties.length})</h3>
          {seller.properties.length === 0 ? (
            <EmptyState title="No properties" description="Properties this seller offers appear here." />
          ) : (
            <ul className="history-list" aria-label="Proposed properties">
              {seller.properties.map((p) => (
                <li key={p.id}>
                  <Link to={`/sellers/properties/${p.id}`}><strong>{p.name}</strong></Link>{' '}
                  <span className="id-chip">{p.sellerPropertyNo}</span>{' '}
                  <PropertyStatusPill property={p} />{' '}
                  <EligibilityPill property={p} />
                  <div className="muted">
                    {p.askingPrice != null ? `Asking ${formatInr(p.askingPrice)}` : 'No asking price'}
                    {p.purchasePrice != null ? ` · bought for ${formatInr(p.purchasePrice)}` : ''}
                    {p.unitCode ? <> · unit <Link to={`/units/${p.unitId}`} className="id-chip">{p.unitCode}</Link></> : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <FollowUpsSection anchor={{ sellerId: seller.id }} branchId={seller.branchId} />

        <Card className="detail-card detail-section-full">
          <h3>Status history</h3>
          <SellerHistory history={seller.history} hideRefs={['seller']} emptyDescription="Every change to this seller's status is recorded here." />
        </Card>

        <DocumentsPanel entityType="seller" entityId={seller.id} canAdd={!seller.isArchived} />

        {canSeeTimeline && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this seller will appear here." />
          </Card>
        )}
      </div>

      {dialog === 'property' && <PropertyCreateModal seller={seller} onClose={close} />}
      {dialog === 'notes' && <SellerNotesModal seller={seller} onClose={close} />}
      {dialog === 'status' && <SellerStatusDialog seller={seller} onClose={close} />}
      {dialog === 'assign' && <SellerAssignDialog seller={seller} onClose={close} />}
      <ConfirmDialog
        open={dialog === 'archive'}
        onClose={close}
        title={`Archive ${seller.personName}?`}
        description="The seller leaves the active list. Their properties, any units bought from them and the full history are kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(seller.id);
          toast.success('Seller archived');
          navigate('/sellers');
        }}
      />
    </div>
  );
}

export function SellerDetailPage() {
  const { id } = useParams();
  const query = useSeller(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Seller not found' }}>
      {(seller) => <SellerDetail seller={seller} />}
    </QueryState>
  );
}
