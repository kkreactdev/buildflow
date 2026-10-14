/**
 * Status vocabularies for Seller Management.
 *
 * These are MASTER rows, exactly like UNIT_STATUS / FOLLOWUP_STATUS: admins may rename, recolour or
 * deactivate them, and business code references the immutable `systemKey` (never the label or id).
 *
 * Deliberately NOT modelled as a WorkflowDefinition chain: the existing state machine is enquiry-shaped
 * (`enquiries.edit` permissions, LOST/REOPEN directions, a single stage column). Seller Management has
 * several independent axes (seller relationship, property qualification, acquisition, development), so
 * the rules live in the service as an explicit allow-map per operation. That keeps the existing
 * workflow module untouched and makes each rule testable on its own.
 */
import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { Master } from '../masters/master.model';

export interface MasterRef {
  _id: Types.ObjectId;
  label: string;
  systemKey: string;
  color?: string;
}

/** The seller relationship lifecycle. */
export const SELLER_STATUS = {
  REGISTERED: 'REGISTERED',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  INACTIVE: 'INACTIVE',
} as const;
export type SellerStatusKey = (typeof SELLER_STATUS)[keyof typeof SELLER_STATUS];
export const INITIAL_SELLER_STATUS: SellerStatusKey = SELLER_STATUS.REGISTERED;

/** The proposed-property lifecycle, from registration through to being offered to buyers. */
export const PROPERTY_STATUS = {
  PROPOSED: 'PROPOSED',
  UNDER_VERIFICATION: 'UNDER_VERIFICATION',
  VERIFIED: 'VERIFIED',
  NEGOTIATION: 'NEGOTIATION',
  APPROVED: 'APPROVED',
  PURCHASED: 'PURCHASED',
  REFURBISHMENT: 'REFURBISHMENT',
  READY_TO_SELL: 'READY_TO_SELL',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type PropertyStatusKey = (typeof PROPERTY_STATUS)[keyof typeof PROPERTY_STATUS];
export const INITIAL_PROPERTY_STATUS: PropertyStatusKey = PROPERTY_STATUS.PROPOSED;

/**
 * Statuses from which no further move is allowed. A property that has been rejected or withdrawn is
 * closed for good. Purchase and ready-to-sell are NOT terminal here — the service applies the stricter,
 * order-dependent guards.
 */
export const TERMINAL_PROPERTY_STATUSES: readonly PropertyStatusKey[] = [PROPERTY_STATUS.REJECTED, PROPERTY_STATUS.WITHDRAWN];

/** Proposals still being worked before any purchase: what blocks archiving a seller. */
export const OPEN_PROPERTY_STATUSES: readonly PropertyStatusKey[] = [
  PROPERTY_STATUS.PROPOSED,
  PROPERTY_STATUS.UNDER_VERIFICATION,
  PROPERTY_STATUS.VERIFIED,
  PROPERTY_STATUS.NEGOTIATION,
  PROPERTY_STATUS.APPROVED,
];

/** A seller in one of these cannot offer new properties, and none of their properties can be approved or bought. */
export const CLOSED_SELLER_STATUSES: readonly SellerStatusKey[] = [SELLER_STATUS.REJECTED, SELLER_STATUS.INACTIVE];

export type StatusType = 'SELLER_STATUS' | 'PROPERTY_STATUS';

/** Resolves a master row by type + immutable system key. */
export async function masterByKey(type: StatusType, key: string): Promise<MasterRef> {
  const m = await systemRepo(Master, 'integrity', 'seller status lookup').findOne({ type, systemKey: key }).lean<MasterRef>();
  if (!m) throw new AppError('STATUS_NOT_CONFIGURED', 500, `The ${type} "${key}" is missing. Run the seed.`);
  return m;
}

/**
 * Every value of a status vocabulary, keyed by its stable key (systemKey, else code), including inactive
 * ones so a renamed or retired label still renders on old records. One query per list instead of one per row.
 */
export async function statusLabels(type: StatusType): Promise<Map<string, { label: string; color?: string }>> {
  const rows = await systemRepo(Master, 'integrity', 'seller status labels').find({ type }).select('code systemKey label color').lean<{ code: string; systemKey?: string; label: string; color?: string }[]>();
  return new Map(rows.map((m) => [m.systemKey ?? m.code, { label: m.label, color: m.color }]));
}