import type { Types } from 'mongoose';
import type { Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { toObjectId } from '../../lib/ids';
import { Booking } from '../bookings/booking.model';
import { Client } from '../clients/client.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { Referral } from '../referrals/referral.model';
import { Seller, SellerProperty } from '../sellers/seller.model';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import { Unit } from '../units/unit.model';

/**
 * The business records a document can be attached to. A document inherits ALL of its access rules from the record it hangs
 * off: whoever cannot see that record (branch, assignment) cannot see, list, fetch, change or attach to its documents.
 * Each entry resolves a record through the caller's own scoped repository, so nothing here can widen access.
 */
export const DOCUMENT_ENTITY_TYPES = ['client', 'enquiry', 'unit', 'sitevisit', 'booking', 'referral', 'seller', 'sellerProperty'] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

export interface ResolvedEntity {
  id: Types.ObjectId;
  branchId: Types.ObjectId;
  /** The human-facing number (CL-…, ENQ-…, UNT-…, SV-…, BK-…, REF-…, SEL-…, SPP-…). */
  number: string;
  isArchived: boolean;
}

interface EntityDef {
  label: string;
  resolve: (principal: Principal, id: string) => Promise<ResolvedEntity | null>;
}

type Row = { _id: Types.ObjectId; branchId: Types.ObjectId; isArchived?: boolean } & Record<string, unknown>;

const via = (model: Parameters<typeof scopedRepo>[0], numberField: string) => async (principal: Principal, id: string): Promise<ResolvedEntity | null> => {
  const r = await scopedRepo(model, principal, { includeArchived: true }).findById(id).select(`branchId ${numberField} isArchived`).lean<Row>();
  return r ? { id: r._id, branchId: r.branchId, number: String(r[numberField]), isArchived: Boolean(r.isArchived) } : null;
};

export const DOCUMENT_ENTITIES: Record<DocumentEntityType, EntityDef> = {
  client: { label: 'Client', resolve: via(Client, 'clientNo') },
  enquiry: { label: 'Enquiry', resolve: via(Enquiry, 'enquiryNo') },
  unit: { label: 'Unit', resolve: via(Unit, 'unitCode') },
  sitevisit: { label: 'Site visit', resolve: via(SiteVisit, 'visitNo') },
  booking: { label: 'Booking', resolve: via(Booking, 'bookingNo') },
  referral: { label: 'Referral', resolve: via(Referral, 'referralNo') },
  // Title deeds, sale agreements and registry papers for properties the company is buying.
  seller: { label: 'Seller', resolve: via(Seller, 'sellerNo') },
  sellerProperty: { label: 'Seller property', resolve: via(SellerProperty, 'sellerPropertyNo') },
};

export const isEntityType = (t: string): t is DocumentEntityType => (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(t);

/** The entity as the caller may see it, or null (not found and not visible are indistinguishable). */
export async function resolveEntity(principal: Principal, type: DocumentEntityType, id: string): Promise<ResolvedEntity | null> {
  try {
    toObjectId(id);
  } catch {
    return null;
  }
  return DOCUMENT_ENTITIES[type].resolve(principal, id);
}
