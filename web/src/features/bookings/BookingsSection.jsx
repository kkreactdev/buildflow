import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBookings } from '../../api/bookings';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePermissions } from '../../hooks/usePermissions';
import { formatWhen } from '../followups/datetime';
import { BookingFormModal } from './BookingFormModal';
import { BookingStatusPill } from './BookingStatusPill';
import '../sitevisits/sitevisits.css';

/** The bookings of one enquiry, with "Book a unit". `canBook` comes from the enquiry (open, not lost). */
export function BookingsSection({ enquiry, canBook = true }) {
  const { can } = usePermissions();
  const canView = can('bookings.view');
  const query = useBookings({ enquiryId: enquiry.id, limit: 20, sort: '-bookingDate' }, { enabled: canView });
  const [booking, setBooking] = useState(false);
  if (!canView) return null;
  const rows = query.data?.rows ?? [];
  return (
    <Card className="detail-card">
      <div className="fu-section-head">
        <h3>Bookings</h3>
        {can('bookings.create') && canBook && <Button variant="secondary" onClick={() => setBooking(true)}>Book a unit</Button>}
      </div>
      {query.isError ? (
        <EmptyState title="Bookings unavailable" description={query.error.message} />
      ) : rows.length === 0 && !query.isPending ? (
        <EmptyState title="No bookings yet" description="Book a unit once the customer decides." />
      ) : (
        <div aria-label="Bookings">
          {rows.map((b) => (
            <div key={b.id} className="visit-row">
              <div>
                <Link to={`/bookings/${b.id}`}><strong>{b.bookingNo}</strong></Link> · <Link to={`/units/${b.unitId}`}>{b.unitCode}</Link> <BookingStatusPill booking={b} />
                <div className="muted">{formatWhen(b.bookingDate)}{b.salespersonName ? ` · ${b.salespersonName}` : ''}{b.clientId ? <> · <Link to={`/clients/${b.clientId}`}>{b.clientNo}</Link></> : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {booking && <BookingFormModal enquiry={{ id: enquiry.id, enquiryNo: enquiry.enquiryNo, name: enquiry.name, branchId: enquiry.branchId }} onClose={() => setBooking(false)} />}
    </Card>
  );
}
