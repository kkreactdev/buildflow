/**
 * The only UNIT_STATUS keys code may name. Labels and colours stay editable masters; further statuses
 * can be added as masters without a code change (they are plain, non-booking statuses).
 */
export const UNIT_STATUS_KEYS = { AVAILABLE: 'AVAILABLE', BOOKED: 'BOOKED', SOLD: 'SOLD', UNDER_DEVELOPMENT: 'UNDER_DEVELOPMENT' } as const;
export type UnitStatusKey = (typeof UNIT_STATUS_KEYS)[keyof typeof UNIT_STATUS_KEYS];

/** A unit starts here; it is never client-supplied. */
export const INITIAL_STATUS: UnitStatusKey = UNIT_STATUS_KEYS.AVAILABLE;

/**
 * Statuses owned by another operation. The generic status endpoint can neither enter nor leave them, so
 * a booking can only be made or released through the booking workflow (Phase 9).
 */
export const BOOKING_OWNED: ReadonlySet<string> = new Set([UNIT_STATUS_KEYS.BOOKED]);

/**
 * Owned by Seller Management: a unit bought from a seller is created UNDER_DEVELOPMENT and leaves it only
 * when its property is marked Ready to Sell. The generic status endpoint can neither enter nor leave it,
 * so stock that is still being refurbished can never be made sellable from the Units page.
 */
export const SELLER_OWNED: ReadonlySet<string> = new Set([UNIT_STATUS_KEYS.UNDER_DEVELOPMENT]);
