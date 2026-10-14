import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTimeline } from '../../api/clients';
import { useSellerProperty } from '../../api/sellers';
import { QueryState } from '../../components/data/QueryState';
import { Timeline } from '../../components/data/Timeline';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pill } from '../../components/ui/Pill';
import { StatusPill } from '../../components/ui/StatusPill';
import { usePermissions } from '../../hooks/usePermissions';
import { formatDateFull, formatDateTime, formatInr } from '../../lib/format';
import { DocumentsPanel } from '../documents/DocumentsPanel';
import { FollowUpsSection } from '../followups/FollowUpsSection';
import { ApproveDialog, ClosePropertyDialog, NegotiationDialog, PropertyEditModal, PurchaseDialog, ReadyToSellDialog, VerificationDialog, WorkDialog } from './SellerDialogs';
import { CHECKLIST_FIELDS } from './sellerChecklist';
import { SellerHistory } from './SellerHistory';
import { EligibilityPill, PropertyStatusPill, SellerStatusPill } from './SellerPills';
import '../clients/clients.css';
import '../enquiries/enquiries.css';
import './sellers.css';

/** The agreed workflow, as the page shows it. Verification and negotiation may overlap, so they share a step. */
const STEPS = [
  { key: 'evaluate', label: 'Verification & negotiation', statuses: ['PROPOSED', 'UNDER_VERIFICATION', 'VERIFIED', 'NEGOTIATION'] },
  { key: 'approved', label: 'Approved', statuses: ['APPROVED'] },
  { key: 'purchased', label: 'Purchased · unit created', statuses: ['PURCHASED'] },
  { key: 'development', label: 'Refurbishment / development', statuses: ['REFURBISHMENT'] },
  { key: 'ready', label: 'Ready to sell', statuses: ['READY_TO_SELL'] },
];

function Steps({ statusKey }) {
  const current = STEPS.findIndex((s) => s.statuses.includes(statusKey));
  if (current < 0) return null; // closed (rejected / withdrawn): the banner says so instead
  return (
    <ol className="seller-steps" aria-label="Purchase pipeline">
      {STEPS.map((s, i) => (
        <li key={s.key} className={i < current || statusKey === 'READY_TO_SELL' ? 'is-done' : i === current ? 'is-current' : ''} aria-current={i === current ? 'step' : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

const CHECK_COLORS = { PASSED: '#16a34a', FAILED: '#dc2626', PENDING: '#d97706' };
function CheckPill({ value }) {
  const color = CHECK_COLORS[value] ?? '#64748b';
  return <Pill label={value ? value[0] + value.slice(1).toLowerCase() : 'Not checked'} size="sm" dot color={color} bg={`${color}1f`} />;
}

const money = (n) => (n != null ? formatInr(n) : '—');
const WORK_KINDS = { START: 'Started', UPDATE: 'Progress', COMPLETE: 'Completed' };

/** What the next gate still needs, from the server's own check, so the page never guesses. */
function NextStep({ property }) {
  const { statusKey, blockers = {}, allowed = {} } = property;
  let title = null;
  let items = [];
  if (['PROPOSED', 'UNDER_VERIFICATION', 'VERIFIED', 'NEGOTIATION'].includes(statusKey)) {
    title = blockers.approve?.length ? 'Before approval' : allowed.approve ? 'Ready for approval' : 'Awaiting approval by an authorised user';
    items = blockers.approve ?? [];
  } else if (statusKey === 'APPROVED') {
    title = allowed.purchase ? 'Ready to complete the purchase' : 'Awaiting purchase completion by an authorised user';
    items = blockers.purchase ?? [];
  } else if (statusKey === 'PURCHASED' || statusKey === 'REFURBISHMENT') {
    title = blockers.release?.length ? 'Before release to buyers' : allowed.release ? 'Ready to release to buyers' : 'Awaiting release by an authorised user';
    items = blockers.release ?? [];
  }
  if (!title) return null;
  return (
    <Card className="detail-card detail-section-full">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul className="seller-blockers">{items.map((b) => <li key={b}>{b}</li>)}</ul>
      ) : (
        <p className="muted">Nothing outstanding.</p>
      )}
    </Card>
  );
}

function PropertyDetail({ property }) {
  const { can } = usePermissions();
  const [dialog, setDialog] = useState(null);
  const close = () => setDialog(null);
  const a = property.allowed ?? {};
  const closed = ['REJECTED', 'WITHDRAWN'].includes(property.statusKey);
  const canSeeTimeline = can('activities.view');
  const timeline = useTimeline('sellerProperty', canSeeTimeline ? property.id : null);
  const v = property.verification;

  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to={`/sellers/${property.sellerId}`} className="muted">← {property.sellerName ?? property.sellerNo}</Link>
          <h2>{property.name}</h2>
          <span className="id-chip">{property.sellerPropertyNo}</span>{' '}
          <PropertyStatusPill property={property} />{' '}
          <EligibilityPill property={property} />
        </div>
        <div className="detail-actions">
          {a.approve && <Button onClick={() => setDialog('approve')}>Approve for purchase</Button>}
          {a.purchase && <Button onClick={() => setDialog('purchase')}>Complete purchase</Button>}
          {a.startWork && <Button onClick={() => setDialog('start')}>Start development</Button>}
          {a.completeWork && <Button onClick={() => setDialog('complete')}>Complete development</Button>}
          {a.release && <Button onClick={() => setDialog('ready')}>Mark ready to sell</Button>}
          {a.verify && <Button variant="secondary" onClick={() => setDialog('verify')}>{v ? 'Update verification' : 'Verify'}</Button>}
          {a.negotiate && <Button variant="secondary" onClick={() => setDialog('negotiate')}>Record negotiation</Button>}
          {a.updateWork && <Button variant="secondary" onClick={() => setDialog('update')}>Record progress</Button>}
          {a.edit && <Button variant="secondary" onClick={() => setDialog('edit')}>Edit</Button>}
          {a.withdraw && <Button variant="secondary" onClick={() => setDialog('withdraw')}>Seller withdrew</Button>}
          {a.reject && <Button variant="danger" onClick={() => setDialog('reject')}>Reject</Button>}
        </div>
      </div>

      <Steps statusKey={property.statusKey} />

      {closed && (
        <Card className="detail-card">
          <p className="muted">
            This property is <strong>{property.status?.label ?? property.statusKey}</strong> and closed: it can no longer be verified, negotiated, approved or
            purchased. The record and its full history are kept.
          </p>
        </Card>
      )}

      <div className="detail-grid">
        {!closed && <NextStep property={property} />}

        <Card className="detail-card">
          <h3>Property</h3>
          <dl className="kv">
            <dt>Address</dt><dd>{[property.address, property.city, property.state, property.pincode].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Plot area</dt><dd>{property.plotArea != null ? `${property.plotArea.toLocaleString('en-IN')} sq ft` : '—'}</dd>
            <dt>Built-up</dt><dd>{property.builtUpArea != null ? `${property.builtUpArea.toLocaleString('en-IN')} sq ft` : '—'}</dd>
            <dt>Bedrooms / baths</dt><dd>{property.bedrooms ?? '—'} / {property.bathrooms ?? '—'}</dd>
            <dt>Description</dt><dd>{property.description ?? '—'}</dd>
            <dt>Notes</dt><dd>{property.notes ?? '—'}</dd>
            <dt>Handled by</dt><dd>{property.assignedToName ?? <span className="muted">Unassigned</span>}</dd>
          </dl>
        </Card>

        <Card className="detail-card">
          <h3>Seller</h3>
          {property.seller ? (
            <dl className="kv">
              <dt>Name</dt><dd><Link to={`/sellers/${property.sellerId}`}>{property.seller.personName}</Link> <span className="id-chip">{property.seller.sellerNo}</span></dd>
              <dt>Status</dt><dd><SellerStatusPill seller={property.seller} /></dd>
            </dl>
          ) : (
            <p className="muted">{property.sellerNo}</p>
          )}
          <h3>Price</h3>
          <dl className="kv">
            <dt>Asking</dt><dd>{money(property.askingPrice)}</dd>
            <dt>Paid</dt><dd>{property.purchasePrice != null ? formatInr(property.purchasePrice) : <span className="muted">Not purchased</span>}</dd>
            <dt>Purchase date</dt><dd>{property.purchaseDate ? formatDateFull(property.purchaseDate) : '—'}</dd>
            <dt>Reference</dt><dd>{property.purchaseReference ?? '—'}</dd>
          </dl>
        </Card>

        <Card className="detail-card">
          <h3>Inventory</h3>
          <dl className="kv">
            <dt>Unit</dt>
            <dd>
              {property.unitCode ? (
                <>
                  <Link to={`/units/${property.unitId}`} className="id-chip">{property.unitCode}</Link>
                  <div className="muted">Created {formatDateTime(property.unitCreatedAt)}</div>
                </>
              ) : (
                <span className="muted">Created when the purchase is completed</span>
              )}
            </dd>
            <dt>Buyers</dt><dd><EligibilityPill property={property} /></dd>
          </dl>
          {property.unitId && !property.eligibleForBuyers && (
            <p className="muted">The unit is held under development: it is not offered in enquiries or bookable until this property is marked ready to sell.</p>
          )}
        </Card>

        <Card className="detail-card detail-section-full">
          <h3>Verification</h3>
          {v ? (
            <>
              <p>
                Outcome <CheckPill value={v.outcome} />{' '}
                <span className="muted">· {v.verifiedByName ?? 'recorded'} · {formatDateTime(v.verifiedAt)}</span>
              </p>
              <dl className="kv">
                {CHECKLIST_FIELDS.map(([key, label]) => (
                  <Fragment key={key}>
                    <dt>{label}</dt>
                    <dd><CheckPill value={v.checklist?.[key]} /></dd>
                  </Fragment>
                ))}
              </dl>
              {v.notes && <p className="muted">{v.notes}</p>}
            </>
          ) : (
            <p className="muted">Not verified yet. Every check (title deed, encumbrance, tax records, site inspection, measurements) must pass before approval.</p>
          )}
        </Card>

        <Card className="detail-card detail-section-full">
          <h3>Negotiation{property.negotiations?.length ? ` (${property.negotiations.length} rounds)` : ''}</h3>
          {property.negotiations?.length ? (
            <ul className="history-list" aria-label="Negotiation rounds">
              {property.negotiations.map((n) => (
                <li key={n.id}>
                  <strong>{formatDateFull(n.discussedOn ?? n.at)}</strong>{' '}
                  <Pill label={n.outcome[0] + n.outcome.slice(1).toLowerCase()} size="sm" />
                  <div>
                    {[n.askingPrice != null && `Seller asked ${formatInr(n.askingPrice)}`, n.offeredPrice != null && `we offered ${formatInr(n.offeredPrice)}`, n.counterPrice != null && `they countered ${formatInr(n.counterPrice)}`].filter(Boolean).join(' · ')}
                  </div>
                  <div className="muted">{n.notes ? `${n.notes} · ` : ''}{n.byName ? `recorded by ${n.byName}` : ''}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No rounds yet. Negotiation can start before verification finishes.</p>
          )}
        </Card>

        {property.unitId && (
          <Card className="detail-card detail-section-full">
            <h3>Refurbishment / development</h3>
            <dl className="kv">
              <dt>Started</dt><dd>{property.workStartedAt ? formatDateFull(property.workStartedAt) : '—'}</dd>
              <dt>Completed</dt><dd>{property.workCompletedAt ? formatDateFull(property.workCompletedAt) : '—'}</dd>
              <dt>Estimated / actual</dt><dd>{money(property.estimatedCost)} / {money(property.actualCost)}</dd>
              <dt>Responsible</dt><dd>{property.workAssignedToName ?? '—'}</dd>
            </dl>
            {property.work?.length ? (
              <ul className="history-list" aria-label="Work log">
                {property.work.map((w) => (
                  <li key={w.id}>
                    <StatusPill statusKey={w.kind === 'COMPLETE' ? 'COMPLETED' : w.kind === 'START' ? 'SCHEDULED' : 'PENDING'} label={WORK_KINDS[w.kind] ?? w.kind} />{' '}
                    {w.notes ?? ''}
                    <div className="muted">
                      {formatDateTime(w.at)}{w.byName ? ` · ${w.byName}` : ''}
                      {w.startedOn ? ` · started ${formatDateFull(w.startedOn)}` : ''}
                      {w.completedOn ? ` · completed ${formatDateFull(w.completedOn)}` : ''}
                      {w.estimatedCost != null ? ` · estimate ${formatInr(w.estimatedCost)}` : ''}
                      {w.actualCost != null ? ` · actual ${formatInr(w.actualCost)}` : ''}
                      {w.workAssignedToName ? ` · responsible ${w.workAssignedToName}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No work recorded" description="Start development to begin the work log." />
            )}
          </Card>
        )}

        <FollowUpsSection anchor={{ sellerPropertyId: property.id }} branchId={property.branchId} />

        <Card className="detail-card detail-section-full">
          <h3>Status history</h3>
          <SellerHistory history={property.history} emptyDescription="Every change to this property's status is recorded here." />
        </Card>

        <DocumentsPanel entityType="sellerProperty" entityId={property.id} canAdd={!closed} />

        {canSeeTimeline && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this property will appear here." />
          </Card>
        )}
      </div>

      {dialog === 'edit' && <PropertyEditModal property={property} onClose={close} />}
      {dialog === 'verify' && <VerificationDialog property={property} onClose={close} />}
      {dialog === 'negotiate' && <NegotiationDialog property={property} onClose={close} />}
      {dialog === 'approve' && <ApproveDialog property={property} onClose={close} />}
      {dialog === 'purchase' && <PurchaseDialog property={property} onClose={close} />}
      {['start', 'update', 'complete'].includes(dialog) && <WorkDialog property={property} mode={dialog} onClose={close} />}
      {dialog === 'ready' && <ReadyToSellDialog property={property} onClose={close} />}
      {(dialog === 'reject' || dialog === 'withdraw') && <ClosePropertyDialog property={property} kind={dialog} onClose={close} />}
    </div>
  );
}

export function SellerPropertyDetailPage() {
  const { id } = useParams();
  const query = useSellerProperty(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Property not found' }}>
      {(property) => <PropertyDetail property={property} />}
    </QueryState>
  );
}
