import { DocumentsPanel } from '../documents/DocumentsPanel';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTimeline } from '../../api/clients';
import { api } from '../../api/http';
import { useUnit, useUnitMutations } from '../../api/units';
import { QueryState } from '../../components/data/QueryState';
import { Timeline } from '../../components/data/Timeline';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pill } from '../../components/ui/Pill';
import { StatusPill } from '../../components/ui/StatusPill';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { formatDate, formatDateTime, formatInr } from '../../lib/format';
import { UnitInterestedEnquiries } from '../relations/UnitInterestsCard';
import { UnitBookingCard } from '../bookings/UnitBookingCard';
import { UnitAssignDialog, UnitStatusDialog } from './UnitDialogs';
import { UnitEditModal } from './UnitFormModal';
import { UnitMedia } from './UnitMedia';
import { UnitStatusPill } from './UnitStatusPill';
import '../clients/clients.css';
import '../enquiries/enquiries.css';
import './units.css';

/**
 * Where this unit came from when the company bought it through Seller Management. Present only for such units and only
 * for users who may see that seller; until the property is released the unit stays withheld from buyers.
 */
function AcquisitionCard({ acquisition: a }) {
  return (
    <Card className="detail-card">
      <h3>Acquired from a seller</h3>
      <dl className="kv">
        <dt>Seller</dt><dd><Link to={`/sellers/${a.sellerId}`}>{a.sellerName ?? a.sellerNo}</Link> <span className="id-chip">{a.sellerNo}</span></dd>
        <dt>Property</dt><dd><Link to={`/sellers/properties/${a.sellerPropertyId}`} className="id-chip">{a.sellerPropertyNo}</Link> <StatusPill statusKey={a.statusKey} label={a.status?.label} color={a.status?.color} /></dd>
        <dt>Purchased</dt><dd>{a.purchaseDate ? formatDate(a.purchaseDate) : '—'}{a.purchasePrice != null ? ` · ${formatInr(a.purchasePrice)}` : ''}</dd>
        <dt>Buyers</dt>
        <dd>{a.releasedToBuyers ? 'Released — can be offered to buyers' : <span className="muted">Withheld until the property is marked ready to sell</span>}</dd>
      </dl>
    </Card>
  );
}

const val = (m) => (m ? (m.isActive === false ? `${m.label} (inactive)` : m.label) : '—');
const num = (n, suffix = '') => (n == null ? '—' : `${n.toLocaleString('en-IN')}${suffix}`);

function AuditList({ id }) {
  const q = useQuery({ queryKey: ['audit', 'unit', id], queryFn: () => api.list('audit', { query: { entityType: 'unit', entityId: id, limit: 50 } }), retry: false });
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

function UnitDetail({ unit }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = usePermissions();
  const { archive } = useUnitMutations();
  const canTimeline = can('activities.view');
  const timeline = useTimeline('unit', canTimeline ? unit.id : null);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const a = unit.allowed;
  const hasCoords = unit.latitude != null && unit.longitude != null;

  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to="/units" className="muted">← Units / Properties</Link>
          <h2>{unit.name} {unit.isArchived && <Pill label="Archived" size="sm" />}</h2>
          <span className="id-chip">{unit.unitCode}</span> <UnitStatusPill unit={unit} />
        </div>
        <div className="detail-actions">
          {a.changeStatus && <Button onClick={() => setChangingStatus(true)}>Change status…</Button>}
          {a.assign && <Button variant="secondary" onClick={() => setAssigning(true)}>{unit.assignedTo ? 'Reassign' : 'Assign'}</Button>}
          {a.edit && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          {a.archive && <ActionMenu items={[{ label: 'Archive', danger: true, onSelect: () => setArchiving(true) }]} />}
        </div>
      </div>

      <div className="detail-grid">
        <Card className="detail-card">
          <h3>Property</h3>
          <dl className="kv">
            <dt>Unit ID</dt><dd className="id-chip">{unit.unitCode}</dd>
            <dt>Status</dt><dd><UnitStatusPill unit={unit} /></dd>
            <dt>Branch</dt><dd>{unit.branch?.name ?? '—'}</dd>
            <dt>Property type</dt><dd>{val(unit.propertyType)}</dd>
            <dt>Building type</dt><dd>{val(unit.buildingType)}</dd>
            <dt>Location</dt><dd>{val(unit.location)}</dd>
            <dt>Expected price</dt><dd>{unit.expectedPrice != null ? formatInr(unit.expectedPrice) : '—'}</dd>
            <dt>Plot area</dt><dd>{num(unit.plotArea, ' sq ft')}</dd>
            <dt>Built-up area</dt><dd>{num(unit.builtUpArea, ' sq ft')}</dd>
            <dt>Bedrooms</dt><dd>{num(unit.bedrooms)}</dd>
            <dt>Bathrooms</dt><dd>{num(unit.bathrooms)}</dd>
            <dt>Description</dt><dd>{unit.description ?? '—'}</dd>
            <dt>Created</dt><dd>{formatDateTime(unit.createdAt)}</dd>
          </dl>
        </Card>
        <Card className="detail-card">
          <h3>Address</h3>
          <dl className="kv">
            <dt>Address</dt><dd>{unit.address ?? '—'}</dd>
            <dt>City</dt><dd>{unit.city ?? '—'}</dd>
            <dt>State</dt><dd>{unit.state ?? '—'}</dd>
            <dt>Pincode</dt><dd>{unit.pincode ?? '—'}</dd>
            <dt>Coordinates</dt>
            <dd>{hasCoords ? <a href={`https://www.google.com/maps?q=${unit.latitude},${unit.longitude}`} target="_blank" rel="noreferrer">{unit.latitude}, {unit.longitude}</a> : '—'}</dd>
          </dl>
        </Card>

        <Card className="detail-card">
          <h3>Salesperson</h3>
          <dl className="kv"><dt>Assigned to</dt><dd>{unit.assignedToName ?? 'Unassigned'}</dd></dl>
          {unit.assignments.length === 0 ? (
            <p className="muted">No assignment history yet.</p>
          ) : (
            <ul className="history-list" aria-label="Assignment history">
              {[...unit.assignments].reverse().map((x) => (
                <li key={x.id}>
                  {x.fromName ? `${x.fromName} → ` : ''}<strong>{x.toName ?? 'User'}</strong>
                  <div className="muted">{formatDateTime(x.at)}{x.byName ? ` · by ${x.byName}` : ''}{x.reason ? ` · “${x.reason}”` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {unit.acquisition && <AcquisitionCard acquisition={unit.acquisition} />}
        <UnitBookingCard unit={unit} />
        <UnitInterestedEnquiries unit={unit} />

        <UnitMedia unit={unit} />

        <DocumentsPanel entityType="unit" entityId={unit.id} canAdd={!unit.isArchived} />
        {canTimeline && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this unit will appear here." />
          </Card>
        )}
        {can('audit.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Audit history</h3>
            <AuditList id={unit.id} />
          </Card>
        )}
      </div>

      {editing && <UnitEditModal unit={unit} onClose={() => setEditing(false)} />}
      {assigning && <UnitAssignDialog unit={unit} onClose={() => setAssigning(false)} />}
      {changingStatus && <UnitStatusDialog unit={unit} onClose={() => setChangingStatus(false)} />}
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={`Archive ${unit.unitCode}?`}
        description="The unit disappears from lists, but its history is kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(unit.id);
          toast.success('Unit archived');
          navigate('/units');
        }}
      />
    </div>
  );
}

export function UnitDetailPage() {
  const { id } = useParams();
  const query = useUnit(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Unit not found' }}>
      {(unit) => <UnitDetail unit={unit} />}
    </QueryState>
  );
}
