import type { Types } from 'mongoose';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { systemRepo } from '../../core/scope/system';
import { toObjectId } from '../../lib/ids';
import { masterByKey, PROPERTY_STATUS } from './seller.masters';
import { Seller, SellerProperty } from './seller.model';

/**
 * Buyer eligibility of units that came through Seller Management, and the unit → seller link.
 *
 * Kept apart from seller.service so that the units, bookings and unit-interest modules can ask these
 * questions without importing the whole seller workflow (which itself creates Units).
 *
 * The withheld checks deliberately do NOT use the caller's data scope. Proposed properties are owned
 * by the seller's assignee, so an OWN-scope salesperson would "see" only their own sellers' properties
 * and a scoped lookup would report someone else's unreleased unit as free to sell. The answer here must
 * be the same for every caller, so the lookup is a global integrity check that returns unit ids only.
 */

type Id = Types.ObjectId;

/** Seller-origin units whose property has not been released are withheld from buyers. Released = READY_TO_SELL. */
const withheld = { unitId: { $type: 'objectId' }, statusKey: { $ne: PROPERTY_STATUS.READY_TO_SELL } };
const lookup = (detail: string) => systemRepo(SellerProperty, 'integrity', detail);

/**
 * The ids of seller-originated units in a branch that are NOT yet released to buyers. The picker queries
 * candidates by branch and only then pages them, so this takes a branch rather than a unit list.
 * Units created any other way have no SellerProperty row and are never affected.
 */
export async function withheldSellerUnitIds(branchId: string | Id): Promise<string[]> {
  const rows = await lookup('withheld seller units in a branch')
    .find({ branchId: typeof branchId === 'string' ? toObjectId(branchId) : branchId, ...withheld })
    .select('unitId')
    .lean<{ unitId: Id }[]>();
  return rows.map((r) => r.unitId.toHexString());
}

/** The single-unit form of the rule above, for the write paths where exactly one unit is checked. */
export async function isUnitWithheldFromBuyers(unitId: Id): Promise<boolean> {
  return Boolean(await lookup('is a seller unit withheld').exists({ ...withheld, unitId }));
}

/**
 * Where a unit came from, for the unit detail page: its seller and proposed property. Only for callers who
 * may view sellers AND can see that property in their own scope; everyone else gets null (a unit that did
 * not come from a seller also gets null). Purchase figures are part of the seller record, so they follow
 * the same visibility.
 */
export async function unitAcquisition(principal: Principal, unitId: Id) {
  if (!hasPermission(principal, 'sellers.view')) return null;
  const p = await scopedRepo(SellerProperty, principal, { includeArchived: true })
    .findOne({ unitId })
    .select('sellerPropertyNo sellerId sellerNo statusKey purchaseDate purchasePrice unitCreatedAt workCompletedAt')
    .lean<{ _id: Id; sellerPropertyNo: string; sellerId: Id; sellerNo: string; statusKey: string; purchaseDate?: Date | null; purchasePrice?: number | null; unitCreatedAt?: Date | null; workCompletedAt?: Date | null }>();
  if (!p) return null;
  const [status, seller] = await Promise.all([
    masterByKey('PROPERTY_STATUS', p.statusKey),
    scopedRepo(Seller, principal, { includeArchived: true }).findById(p.sellerId).select('personName').lean<{ personName: string }>(),
  ]);
  return {
    sellerPropertyId: p._id.toHexString(),
    sellerPropertyNo: p.sellerPropertyNo,
    sellerId: p.sellerId.toHexString(),
    sellerNo: p.sellerNo,
    sellerName: seller?.personName,
    statusKey: p.statusKey,
    status: { label: status.label, color: status.color },
    purchaseDate: p.purchaseDate ?? undefined,
    purchasePrice: p.purchasePrice ?? undefined,
    unitCreatedAt: p.unitCreatedAt ?? undefined,
    workCompletedAt: p.workCompletedAt ?? undefined,
    releasedToBuyers: p.statusKey === PROPERTY_STATUS.READY_TO_SELL,
  };
}
