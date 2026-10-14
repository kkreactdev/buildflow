import { DocumentsPanel } from '../documents/DocumentsPanel';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBooking } from '../../api/bookings';
import { useTimeline } from '../../api/clients';
import { api } from '../../api/http';
import { QueryState } from '../../components/data/QueryState';
import { Timeline } from '../../components/data/Timeline';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePermissions } from '../../hooks/usePermissions';
import { formatDateTime } from '../../lib/format';
import { formatWhen } from '../followups/datetime';
import { BookingEditModal, ReleaseDialog } from './BookingDialogs';
import { BookingStatusPill } from './BookingStatusPill';
import '../clients/clients.css';
import '../enquiries/enquiries.css';

function AuditList({ id }) {
  const q = useQuery({ queryKey: ['audit', 'booking', id], queryFn: () => api.list('audit', { query: { entityType: 'booking', entityId: id, limit: 50 } }), retry: false });
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

function BookingDetail({ booking }) {
  const { can } = usePermissions();
  const timeline = useTimeline('booking', can('activities.view') ? booking.id : null);
  const [releasing, setReleasing] = useState(false);
  const [editing, setEditing] = useState(false);
  const a = booking.allowed;

  return (
    <div>
      <div className="detail-head">
        <div>
          <Link to="/bookings" className="muted">← Bookings</Link>
          <h2>{booking.name}</h2>
          <span className="id-chip">{booking.bookingNo}</span> <BookingStatusPill booking={booking} />
        </div>
        <div className="detail-actions">
          {a.release && <Button onClick={() => setReleasing(true)}>Release…</Button>}
          {a.edit && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      </div>
      <div className="detail-grid">
        <Card className="detail-card">
          <h3>Booking</h3>
          <dl className="kv">
            <dt>Booking ID</dt><dd className="id-chip">{booking.bookingNo}</dd>
            <dt>Status</dt><dd><BookingStatusPill booking={booking} /></dd>
            <dt>Unit</dt><dd><Link to={`/units/${booking.unitId}`}>{booking.unitCode}</Link>{booking.unitName ? ` · ${booking.unitName}` : ''}</dd>
            <dt>Enquiry</dt><dd><Link to={`/enquiries/${booking.enquiryId}`}>{booking.enquiryNo}</Link></dd>
            <dt>Person</dt><dd>{booking.name} · <a href={`tel:${booking.phoneE164}`}>{booking.phone}</a></dd>
            {booking.clientNo && <><dt>Client</dt><dd><Link to={`/clients/${booking.clientId}`}>{booking.clientNo}</Link></dd></>}
            <dt>Branch</dt><dd>{booking.branch?.name ?? '—'}</dd>
            <dt>Salesperson</dt><dd>{booking.salespersonName ?? '—'}</dd>
            <dt>Booked by</dt><dd>{booking.bookedByName ?? '—'}</dd>
            <dt>Booked on</dt><dd>{formatWhen(booking.bookingDate)}</dd>
            <dt>Notes</dt><dd>{booking.notes ?? '—'}</dd>
          </dl>
        </Card>
        {!booking.isActive && (
          <Card className="detail-card">
            <h3>Release</h3>
            <dl className="kv">
              <dt>Released</dt><dd>{formatDateTime(booking.releasedAt)}</dd>
              <dt>Released by</dt><dd>{booking.releasedByName ?? '—'}</dd>
              <dt>Reason</dt><dd>{booking.releaseReason}</dd>
            </dl>
          </Card>
        )}
        <Card className="detail-card">
          <h3>History</h3>
          <ul className="history-list" aria-label="Booking history">
            {booking.history.map((h) => (
              <li key={h.id}>
                <strong>{h.type === 'CREATED' ? 'Booked' : h.type === 'RELEASED' ? 'Released' : 'Updated'}</strong>
                <div className="muted">{formatDateTime(h.at)}{h.byName ? ` · by ${h.byName}` : ''}{h.reason ? ` · “${h.reason}”` : ''}</div>
              </li>
            ))}
          </ul>
        </Card>
        <DocumentsPanel entityType="booking" entityId={booking.id} />
        {can('activities.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Activity</h3>
            <Timeline query={timeline} emptyDescription="Events for this booking will appear here." />
          </Card>
        )}
        {can('audit.view') && (
          <Card className="detail-card detail-section-full">
            <h3>Audit history</h3>
            <AuditList id={booking.id} />
          </Card>
        )}
      </div>
      {releasing && <ReleaseDialog booking={booking} onClose={() => setReleasing(false)} />}
      {editing && <BookingEditModal booking={booking} onClose={() => setEditing(false)} />}
    </div>
  );
}

export function BookingDetailPage() {
  const { id } = useParams();
  const query = useBooking(id);
  return (
    <QueryState query={query} isEmpty={(d) => !d} empty={{ title: 'Booking not found' }}>
      {(booking) => <BookingDetail booking={booking} />}
    </QueryState>
  );
}
