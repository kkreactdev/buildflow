import { StatusPill } from '../../components/ui/StatusPill';

/** Booking states are record states (active / released), not configurable masters. */
export function BookingStatusPill({ booking }) {
  return <StatusPill statusKey={booking.isActive ? 'ACTIVE' : 'RELEASED'} label={booking.isActive ? 'Active' : 'Released'} />;
}
