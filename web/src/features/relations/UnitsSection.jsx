import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUnitInterestMutations } from '../../api/relations';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { LockIcon } from '../../components/ui/icons';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { formatInr } from '../../lib/format';
import { BookingFormModal } from '../bookings/BookingFormModal';
import { BookingStatusPill } from '../bookings/BookingStatusPill';
import { formatWhen } from '../followups/datetime';
import { UnitStatusPill } from '../units/UnitStatusPill';
import { VisitStatusPill } from '../sitevisits/VisitStatusPill';
import { AddUnitModal } from './AddUnitModal';
import { StatePill } from './RelationPill';
import '../sitevisits/sitevisits.css';

/**
 * THE Units section for an enquiry or a client: one entry per unit, however many interests, visits and bookings reference it.
 * The relationship badge (what this person has with the unit), the unit's own inventory status and each booking's status are
 * three separate things, shown side by side. `rows` is null when the viewer may not see units (said, not shown as empty).
 * `enquiries` are the enquiries it may act through (open ones accept new units and bookings).
 */
export function UnitsSection({ rows, enquiries }) {
  const { can } = usePermissions();
  const toast = useToast();
  const { add } = useUnitInterestMutations();
  const [adding, setAdding] = useState(false);
  const [booking, setBooking] = useState(null);
  const open = enquiries.filter((e) => !e.isArchived && e.stage?.kind !== 'LOST');
  const canEdit = can('enquiries.edit') && can('units.view') && open.length > 0;
  const taken = {};
  for (const r of rows ?? []) for (const e of r.enquiries) if (r.interest) (taken[e.id] ??= []).push(r.unitId);

  const through = (r) => open.find((e) => e.id === (r.interest?.enquiryId ?? r.enquiries[0]?.id)) ?? null;
  async function mark(r, status) {
    const e = through(r);
    try {
      await add.mutateAsync({ enquiryId: e.id, unitId: r.unitId, status });
      toast.success(status === 'INTERESTED' ? `${r.unitCode} marked interested` : `${r.unitCode} marked not interested`);
    } catch (err) {
      toast.error(err.message);
    }
  }
  const actions = (r) => {
    const e = through(r);
    const free = r.state !== 'BOOKED' && r.state !== 'SOLD';
    return [
      { label: 'Book unit…', hidden: !(e && free && can('bookings.create') && r.unit?.statusKey === 'AVAILABLE'), onSelect: () => setBooking({ r, e }) },
      { label: 'Mark not interested', hidden: !(e && can('enquiries.edit') && free && r.state !== 'NOT_INTERESTED'), onSelect: () => mark(r, 'NOT_INTERESTED') },
      { label: 'Mark interested', hidden: !(e && can('enquiries.edit') && r.state === 'NOT_INTERESTED'), onSelect: () => mark(r, 'INTERESTED') },
    ];
  };

  return (
    <Card className="detail-card detail-section-full" aria-label="Units">
      <div className="fu-section-head">
        <h3>Units</h3>
        {canEdit && <Button variant="secondary" onClick={() => setAdding(true)}>Add unit</Button>}
      </div>
      {rows === null ? (
        <p className="muted" role="note"><LockIcon size={14} /> You don't have permission to view units.</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No units yet" description="Add the units this person is considering, or book one. Interest alone never marks a unit booked or sold." />
      ) : (
        <div aria-label="Related units">
          {rows.map((r) => (
            <div key={r.unitId} className="visit-row">
              <div>
                <Link to={`/units/${r.unitId}`}><strong>{r.unitCode}</strong></Link>{r.unit?.name ? ` · ${r.unit.name}` : ''} <StatePill state={r.state} />{' '}
                {r.unit && <span title="The unit's own inventory status"><span className="muted">Unit:</span> <UnitStatusPill unit={r.unit} /></span>}
                <div className="muted">
                  {[r.unit?.city, r.unit?.expectedPrice != null ? formatInr(r.unit.expectedPrice) : null].filter(Boolean).join(' · ')}
                  {r.interest?.note ? ` · “${r.interest.note}”` : ''}
                </div>
                {r.purchaser && (
                  <div>Purchaser: {r.purchaser.clientId ? <Link to={`/clients/${r.purchaser.clientId}`}>{r.purchaser.name}{r.purchaser.clientNo ? ` (${r.purchaser.clientNo})` : ''}</Link> : r.purchaser.name} · source enquiry <Link to={`/enquiries/${r.purchaser.enquiryId}`}>{r.purchaser.enquiryNo}</Link> · <Link to={`/bookings/${r.purchaser.bookingId}`}>{r.purchaser.bookingNo}</Link></div>
                )}
                {r.visits.length > 0 && (
                  <div className="muted">Visits: {r.visits.map((v, i) => <span key={v.id}>{i ? ', ' : ''}<Link to={`/site-visits/${v.id}`}>{v.visitNo}</Link> <VisitStatusPill visit={v} /></span>)}</div>
                )}
                {r.bookings.length > 0 && (
                  <ul className="history-list" aria-label={`Bookings of ${r.unitCode}`}>
                    {r.bookings.map((b) => (
                      <li key={b.id}>
                        <Link to={`/bookings/${b.id}`}>{b.bookingNo}</Link> <BookingStatusPill booking={{ isActive: b.status === 'ACTIVE' }} /> · {formatWhen(b.bookingDate)}
                        {b.status !== 'ACTIVE' && b.releasedAt ? ` · released ${formatWhen(b.releasedAt)}${b.releaseReason ? ` (“${b.releaseReason}”)` : ''}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {r.enquiries.length > 0 && <div className="muted">Via {r.enquiries.map((e, i) => <span key={e.id}>{i ? ', ' : ''}<Link to={`/enquiries/${e.id}`}>{e.enquiryNo}</Link></span>)}</div>}
              </div>
              <ActionMenu items={actions(r)} />
            </div>
          ))}
        </div>
      )}
      {adding && <AddUnitModal enquiries={open} taken={taken} onClose={() => setAdding(false)} />}
      {booking && <BookingFormModal unit={{ id: booking.r.unitId, unitCode: booking.r.unitCode, name: booking.r.unit?.name, branchId: booking.e.branchId }} enquiry={{ id: booking.e.id, enquiryNo: booking.e.enquiryNo, name: booking.e.name, branchId: booking.e.branchId }} onClose={() => setBooking(null)} />}
    </Card>
  );
}
