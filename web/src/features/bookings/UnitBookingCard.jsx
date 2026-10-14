import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatWhen } from '../followups/datetime';
import { BookingFormModal } from './BookingFormModal';
import { ReleaseDialog } from './BookingDialogs';
import { BookingStatusPill } from './BookingStatusPill';

/**
 * Booking on the unit page. What is shown (active booking, history) and which buttons exist both come from the
 * server (`unit.booking`), which already applied the user's permissions and scope. Nothing is decided here.
 */
export function UnitBookingCard({ unit }) {
  const b = unit.booking;
  const [booking, setBooking] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const active = b?.active;
  return (
    <Card className="detail-card">
      <div className="fu-section-head">
        <h3>Booking</h3>
        {b?.allowed.book && <Button variant="secondary" onClick={() => setBooking(true)}>Book unit</Button>}
        {b?.allowed.release && active && <Button variant="secondary" onClick={() => setReleasing(true)}>Release…</Button>}
      </div>
      {!b?.visible ? (
        <EmptyState title="Booking details are restricted" description={unit.statusKey === 'BOOKED' ? 'This unit is booked.' : undefined} />
      ) : active ? (
        <dl className="kv">
          <dt>Booking</dt><dd><Link to={`/bookings/${active.id}`}>{active.bookingNo}</Link> <BookingStatusPill booking={active} /></dd>
          <dt>{unit.statusKey === 'SOLD' ? 'Purchaser' : 'Held by'}</dt><dd>{active.clientId ? <><Link to={`/clients/${active.clientId}`}>{active.name}</Link> · <span className="id-chip">{active.clientNo}</span></> : <>{active.name} <span className="muted">(not yet a client)</span></>}</dd>
          <dt>Source enquiry</dt><dd><Link to={`/enquiries/${active.enquiryId}`}>{active.enquiryNo}</Link></dd>
          <dt>Salesperson</dt><dd>{active.salespersonName ?? '—'}</dd>
          <dt>Booked on</dt><dd>{formatWhen(active.bookingDate)}</dd>
        </dl>
      ) : unit.statusKey === 'BOOKED' ? (
        <EmptyState title="Booked" description="This unit is booked, but the booking is not visible to you." />
      ) : (
        <EmptyState title="Not booked" />
      )}
      {unit.sale?.state === 'UNLINKED' && (
        <p className="form-error" role="note">Marked sold, but no active booking links a purchaser. Needs reconciliation; no purchaser is assumed.</p>
      )}
      {unit.sale?.state === 'HIDDEN' && <p className="muted" role="note">Marked sold. The purchaser is not visible to you.</p>}
      {b?.visible && b.history.length > 0 && (
        <>
          <h4>Past bookings</h4>
          <ul className="history-list" aria-label="Past bookings">
            {b.history.map((h) => (
              <li key={h.id}>
                <Link to={`/bookings/${h.id}`}>{h.bookingNo}</Link> · {h.clientId ? <Link to={`/clients/${h.clientId}`}>{h.name}</Link> : h.name} · <Link to={`/enquiries/${h.enquiryId}`}>{h.enquiryNo}</Link>
                <div className="muted">{formatWhen(h.bookingDate)} · released{h.releaseReason ? ` · “${h.releaseReason}”` : ''}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      {booking && <BookingFormModal unit={{ id: unit.id, unitCode: unit.unitCode, name: unit.name, branchId: unit.branchId }} onClose={() => setBooking(false)} />}
      {releasing && active && <ReleaseDialog booking={active} onClose={() => setReleasing(false)} />}
    </Card>
  );
}
