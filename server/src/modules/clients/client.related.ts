import type { Types } from 'mongoose';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { Booking } from '../bookings/booking.model';
import { viewsOf as bookingViews, type BookingLean } from '../bookings/booking.service';
import { Enquiry } from '../enquiries/enquiry.model';
import { viewsOf as enquiryViews, type EnquiryLean } from '../enquiries/enquiry.service';
import { FollowUp } from '../followups/followup.model';
import { viewsOf as followUpViews, type FollowUpLean } from '../followups/followup.service';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import { viewsOf as visitViews, type VisitLean } from '../sitevisits/sitevisit.service';
import { linkedUnits, unitRelations } from '../unitInterests/unitRelations';
import { Client } from './client.model';

type Id = Types.ObjectId;
const LIMIT = 50;

/**
 * Everything connected to a client, resolved through ONE canonical rule: a client is a person in a branch, so the
 * client's enquiries, their follow-ups and site visits, the bookings and the units considered or bought are all reached
 * through that (person, branch) identity, not through a client id that older records may not carry (a booking or visit made
 * before the person became a client has none). Each section is read with the caller's own scope and permission, so the
 * client page can never reveal a record the caller could not open from its own module. A section the caller may not view is
 * `null` (the UI says so), which is different from an empty one.
 */
export async function getClientRelated(principal: Principal, clientId: string) {
  const c = await scopedRepo(Client, principal, { includeArchived: true }).findById(clientId).select('personId branchId personName').lean<{ _id: Id; personId: Id; branchId: Id; personName: string }>();
  if (!c) throw AppError.notFound('Client not found');
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(principal, k);
  const identity = { personId: c.personId, branchId: c.branchId };

  // Enquiry ids of this client, used only to FIND other records (never returned): a follow-up the caller may see, raised on an
  // enquiry they are not assigned, is still the client's follow-up. Each section below is still filtered by the caller's own scope.
  const idScope: Principal = principal.dataScope === 'OWN' ? { ...principal, dataScope: 'BRANCH', branchIds: [c.branchId.toHexString()] } : principal;
  const enquiryIds = (await scopedRepo(Enquiry, idScope, { includeArchived: true }).find(identity).select('_id').lean<{ _id: Id }[]>()).map((e) => e._id);
  const viaClientOrEnquiry = { isArchived: false, $or: [{ clientId: c._id }, { enquiryId: { $in: enquiryIds } }] };

  const [enquiries, followUps, siteVisits, bookings] = await Promise.all([
    can('enquiries.view') ? scopedRepo(Enquiry, principal).find({ ...identity, isArchived: false }).sort({ createdAt: -1 }).limit(LIMIT).lean<EnquiryLean[]>() : null,
    can('followups.view') ? scopedRepo(FollowUp, principal).find(viaClientOrEnquiry).sort({ scheduledAt: -1 }).limit(LIMIT).lean<FollowUpLean[]>() : null,
    can('sitevisits.view') ? scopedRepo(SiteVisit, principal).find(viaClientOrEnquiry).sort({ scheduledAt: -1 }).limit(LIMIT).lean<VisitLean[]>() : null,
    can('bookings.view') ? scopedRepo(Booking, principal).find(identity).sort({ bookingDate: -1 }).limit(LIMIT).lean<BookingLean[]>() : null,
  ]);

  // Units: ONE entry per unit across all of the client's enquiries (bookings, visits and interest merged, never repeated).
  const unitMap = await unitRelations(principal, [{ key: 'c', enquiryIds }]);
  const units = unitMap ? unitMap.get('c') ?? [] : null;

  const section = <R, V>(rows: R[] | null, views: V[] | null) => (rows === null ? null : { rows: views ?? [], truncated: rows.length >= LIMIT });
  const [enq, fu, sv, bk] = await Promise.all([
    enquiries ? enquiryViews(principal, enquiries) : null,
    followUps ? followUpViews(principal, followUps) : null,
    siteVisits ? visitViews(principal, siteVisits) : null,
    bookings ? bookingViews(principal, bookings, true) : null,
  ]);
  return {
    clientId: c._id.toHexString(),
    enquiries: section(enquiries, enq),
    followUps: section(followUps, fu),
    siteVisits: section(siteVisits, sv),
    bookings: section(bookings, bk),
    units: units === null ? null : { rows: units },
  };
}

/**
 * The units linked to a CLIENT, for the site-visit scheduler opened from the client page.
 *
 * It reuses the (person, branch) identity rule of `getClientRelated` rather than any client id stamped on a
 * record, and resolves through the same canonical relationship engine, so a unit touched by several of the
 * client's enquiries is returned ONCE (with all of them under `via`) and never duplicated. `null` means the
 * caller may not view units; `[]` means this client has no linked unit.
 */
export async function getClientLinkedUnits(principal: Principal, clientId: string) {
  const c = await scopedRepo(Client, principal, { includeArchived: true }).findById(clientId).select('personId branchId').lean<{ _id: Id; personId: Id; branchId: Id }>();
  if (!c) throw AppError.notFound('Client not found');
  // Find the enquiries with the caller's own scope, widened to BRANCH for OWN-scope users — the client page
  // must resolve the whole relationship, not just the slice the caller personally owns. Each unit is still
  // re-read with the caller's real scope inside `linkedUnits`, so widening here widens the ID SET only.
  const idScope: Principal = principal.dataScope === 'OWN' ? { ...principal, dataScope: 'BRANCH', branchIds: [c.branchId.toHexString()] } : principal;
  const enquiryIds = (await scopedRepo(Enquiry, idScope, { includeArchived: true }).find({ personId: c.personId, branchId: c.branchId }).select('_id').lean<{ _id: Id }[]>()).map((e) => e._id);
  return { units: await linkedUnits(principal, enquiryIds) };
}
