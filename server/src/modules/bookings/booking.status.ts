/**
 * A booking is ACTIVE until it is released. Released bookings are kept for ever as history and never block a
 * new booking of the unit (the unique index only covers ACTIVE ones). These are record states, not a master:
 * business code owns them, so they are not configurable.
 */
export const BOOKING_STATUS = { active: 'ACTIVE', released: 'RELEASED' } as const;
export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];

export const CONFLICT_STATUS = { open: 'OPEN', resolved: 'RESOLVED' } as const;
export const CONFLICT_RESOLUTION = { keepExisting: 'KEEP_EXISTING', replace: 'REPLACE' } as const;
