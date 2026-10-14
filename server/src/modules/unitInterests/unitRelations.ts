import type { Types } from 'mongoose';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { toObjectId } from '../../lib/ids';
import { Booking } from '../bookings/booking.model';
import { Client } from '../clients/client.model';
import type { BookingLean } from '../bookings/booking.service';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import type { VisitLean } from '../sitevisits/sitevisit.service';
import { Unit } from '../units/unit.model';
import { viewsOf, type UnitLean as UnitDocLean } from '../units/unit.service';
import { UnitInterest } from './unitInterest.model';

type Id = Types.ObjectId;

/**
 * ONE relationship per unit for an enquiry (or a client, through all of its enquiries). Three different things stay separate and are
 * never merged into one field:
 *  - `state`   what this enquiry/client has with the unit (below),
 *  - `unit.statusKey`  the unit's own inventory status,
 *  - the enquiry's stage and each booking's own status (listed under `bookings`).
 * `state` is derived, strongest first, from the real records: SOLD (the unit is Sold and this party holds its active booking) >
 * BOOKED (an active booking) > NOT_INTERESTED (explicitly withdrawn) > SITE_VISIT_COMPLETED > SITE_VISIT_SCHEDULED > INTERESTED >
 * BOOKING_RELEASED (only released bookings remain). Only INTERESTED / NOT_INTERESTED are ever stored (in UnitInterest); every
 * other state follows from visits, bookings and the unit, so a unit appears once however many records reference it.
 * HOLD is intentionally not a state: it would need reservation, expiry and release rules the application does not have.
 */
export type UnitState = 'SOLD' | 'BOOKED' | 'NOT_INTERESTED' | 'SITE_VISIT_COMPLETED' | 'SITE_VISIT_SCHEDULED' | 'INTERESTED' | 'BOOKING_RELEASED';

interface InterestLean { _id: Id; unitId: Id; unitCode: string; enquiryId: Id; enquiryNo: string; status: 'INTERESTED' | 'WITHDRAWN'; note?: string; withdrawReason?: string; createdAt?: Date }
/** The narrow unit projection the relationship engine itself needs (the master labels come from `linkedUnits` on demand). */
interface UnitRefLean { _id: Id; unitCode: string; name: string; statusKey: string; expectedPrice?: number | null; city?: string | null }

export interface UnitRelation {
  unitId: string;
  unitCode: string;
  state: UnitState;
  unit?: { id: string; name: string; statusKey: string; expectedPrice?: number; city?: string };
  /** The stored interest (if any) so the UI can change it; its enquiry is where it belongs. */
  interest?: { id: string; status: 'INTERESTED' | 'NOT_INTERESTED'; note?: string; enquiryId: string; enquiryNo: string };
  enquiries: { id: string; enquiryNo: string }[];
  bookings: { id: string; bookingNo: string; status: string; bookingDate: Date; enquiryId: string; enquiryNo: string; releasedAt?: Date; releaseReason?: string }[];
  visits: { id: string; visitNo: string; statusKey: string; scheduledAt: Date; enquiryId: string }[];
  /** Only for SOLD, and only from the active booking: who bought it and through which enquiry. Never guessed. */
  purchaser?: { name: string; clientId?: string; clientNo?: string; enquiryId: string; enquiryNo: string; bookingId: string; bookingNo: string };
}

const RANK: Record<UnitState, number> = { SOLD: 7, BOOKED: 6, NOT_INTERESTED: 5, SITE_VISIT_COMPLETED: 4, SITE_VISIT_SCHEDULED: 3, INTERESTED: 2, BOOKING_RELEASED: 1 };

/** The relationships of several parties at once (a page of enquiries or clients): three bounded queries in total, whatever the page size. null = the caller may not view units. */
export async function unitRelations(principal: Principal, groups: { key: string; enquiryIds: Id[] }[]): Promise<Map<string, UnitRelation[]> | null> {
  if (!hasPermission(principal, 'units.view')) return null;
  const out = new Map<string, UnitRelation[]>(groups.map((g) => [g.key, []]));
  const ids = [...new Set(groups.flatMap((g) => g.enquiryIds.map((i) => i.toHexString())))];
  if (ids.length === 0) return out;
  const enquiryIds = ids;
  const [interests, bookings, visits] = await Promise.all([
    hasPermission(principal, 'enquiries.view') ? scopedRepo(UnitInterest, principal).find({ enquiryId: { $in: enquiryIds } }).lean<InterestLean[]>() : [],
    hasPermission(principal, 'bookings.view') ? scopedRepo(Booking, principal).find({ enquiryId: { $in: enquiryIds } }).sort({ bookingDate: -1 }).lean<BookingLean[]>() : [],
    hasPermission(principal, 'sitevisits.view') ? scopedRepo(SiteVisit, principal).find({ enquiryId: { $in: enquiryIds }, isArchived: false }).sort({ scheduledAt: -1 }).lean<VisitLean[]>() : [],
  ]);
  const unitIds = [...new Set([...interests.map((i) => i.unitId), ...bookings.map((b) => b.unitId), ...visits.flatMap((v) => (v.units ?? []).map((u) => u.unitId))].map((i) => i.toHexString()))];
  const units = unitIds.length ? await scopedRepo(Unit, principal, { includeArchived: true }).find({ _id: { $in: unitIds } }).select('unitCode name statusKey expectedPrice city').lean<UnitRefLean[]>() : [];
  const unitById = new Map(units.map((u) => [u._id.toHexString(), u]));
  // A booking made before the person became a client carries no client id: the client is the person in the booking's branch.
  const needClient = bookings.filter((b) => b.status === 'ACTIVE' && !b.clientId);
  const clients = needClient.length && hasPermission(principal, 'clients.view')
    ? await scopedRepo(Client, principal).find({ personId: { $in: needClient.map((b) => b.personId) }, branchId: { $in: needClient.map((b) => b.branchId) } }).select('personId branchId clientNo').lean<{ _id: Id; personId: Id; branchId: Id; clientNo: string }[]>()
    : [];

  for (const g of groups) {
    const mine = new Set(g.enquiryIds.map((i) => i.toHexString()));
    const byUnit = new Map<string, UnitRelation>();
    const rel = (unitId: Id, unitCode: string): UnitRelation => {
      const k = unitId.toHexString();
      let r = byUnit.get(k);
      if (!r) {
        const u = unitById.get(k);
        r = { unitId: k, unitCode, state: 'INTERESTED', unit: u ? { id: k, name: u.name, statusKey: u.statusKey, expectedPrice: u.expectedPrice ?? undefined, city: u.city ?? undefined } : undefined, enquiries: [], bookings: [], visits: [] };
        byUnit.set(k, r);
      }
      return r;
    };
    const touch = (r: UnitRelation, enquiryId: Id, enquiryNo: string) => { if (!r.enquiries.some((e) => e.id === enquiryId.toHexString())) r.enquiries.push({ id: enquiryId.toHexString(), enquiryNo }); };

    for (const i of interests.filter((x) => mine.has(x.enquiryId.toHexString()))) {
      const r = rel(i.unitId, i.unitCode);
      touch(r, i.enquiryId, i.enquiryNo);
      const mineOnUnit = r.interest;
      // one stored interest is shown per unit: an active interest wins over a withdrawn one from another enquiry
      if (!mineOnUnit || (mineOnUnit.status === 'NOT_INTERESTED' && i.status === 'INTERESTED')) r.interest = { id: i._id.toHexString(), status: i.status === 'INTERESTED' ? 'INTERESTED' : 'NOT_INTERESTED', note: i.note, enquiryId: i.enquiryId.toHexString(), enquiryNo: i.enquiryNo };
    }
    for (const b of bookings.filter((x) => mine.has(x.enquiryId.toHexString()))) {
      const r = rel(b.unitId, b.unitCode);
      touch(r, b.enquiryId, b.enquiryNo);
      r.bookings.push({ id: b._id.toHexString(), bookingNo: b.bookingNo, status: b.status, bookingDate: b.bookingDate, enquiryId: b.enquiryId.toHexString(), enquiryNo: b.enquiryNo, releasedAt: b.releasedAt ?? undefined, releaseReason: b.releaseReason ?? undefined });
    }
    for (const v of visits.filter((x) => mine.has(x.enquiryId.toHexString()))) {
      for (const u of v.units ?? []) {
        const r = rel(u.unitId, u.unitCode);
        touch(r, v.enquiryId, v.enquiryNo);
        r.visits.push({ id: v._id.toHexString(), visitNo: v.visitNo, statusKey: v.statusKey, scheduledAt: v.scheduledAt, enquiryId: v.enquiryId.toHexString() });
      }
    }

    const clientOf = (b: BookingLean) => {
      if (b.clientId) return { clientId: b.clientId.toHexString(), clientNo: b.clientNo ?? undefined };
      const c = clients.find((x) => x.personId.equals(b.personId) && x.branchId.equals(b.branchId));
      return c ? { clientId: c._id.toHexString(), clientNo: c.clientNo } : {};
    };
    for (const r of byUnit.values()) {
      const active = bookings.find((b) => b.unitId.toHexString() === r.unitId && b.status === 'ACTIVE' && mine.has(b.enquiryId.toHexString()));
      const live = r.visits.filter((v) => v.statusKey !== 'CANCELLED');
      let s: UnitState = 'INTERESTED';
      if (active) s = r.unit?.statusKey === 'SOLD' ? 'SOLD' : 'BOOKED';
      else if (r.interest?.status === 'NOT_INTERESTED') s = 'NOT_INTERESTED';
      else if (live.some((v) => v.statusKey === 'COMPLETED')) s = 'SITE_VISIT_COMPLETED';
      else if (live.length) s = 'SITE_VISIT_SCHEDULED';
      else if (r.interest?.status === 'INTERESTED') s = 'INTERESTED';
      else if (r.bookings.length) s = 'BOOKING_RELEASED';
      r.state = s;
      if (s === 'SOLD' && active) r.purchaser = { name: active.personName, ...clientOf(active), enquiryId: active.enquiryId.toHexString(), enquiryNo: active.enquiryNo, bookingId: active._id.toHexString(), bookingNo: active.bookingNo };
    }
    out.set(g.key, [...byUnit.values()].sort((a, b) => RANK[b.state] - RANK[a.state] || a.unitCode.localeCompare(b.unitCode)));
  }
  return out;
}

/** The compact form for list columns: one entry per unit with just its identity and state. */
export const compact = (rows: UnitRelation[]) => rows.map((r) => ({ unitId: r.unitId, unitCode: r.unitCode, name: r.unit?.name, state: r.state }));

/**
 * One LINKED unit as the scheduling / picking surfaces need it: identity, the unit's own inventory
 * status (labelled from the UNIT_STATUS master, never mixed with `state`) and the relationship
 * that links it. `via` is the set of enquiries the link runs through, so a unit that three of a
 * client's enquiries touch appears ONCE with three `via` entries rather than three rows.
 *
 * This is a read projection over `unitRelations` — no second relationship model, no new stored link.
 * Returns null when the caller may not view units (which is NOT the same as "this party has none").
 */
export interface LinkedUnit {
  id: string;
  unitCode: string;
  name?: string;
  city?: string;
  /** The unit's own inventory status (a UNIT_STATUS master value), kept apart from `state`. */
  statusKey?: string;
  statusLabel?: string;
  statusColor?: string;
  /** What this party HAS with the unit — the derived relationship, not the unit's status. */
  state: UnitState;
  via: { id: string; enquiryNo: string }[];
}

export async function linkedUnits(principal: Principal, enquiryIds: Id[]): Promise<LinkedUnit[] | null> {
  const rows = await unitRelations(principal, [{ key: 'u', enquiryIds }]);
  if (rows === null) return null;
  const relations = rows.get('u') ?? [];
  if (relations.length === 0) return [];
  // The relations already resolved each unit's statusKey; we need the master's label and colour
  // so the picker can show a real status rather than a raw key. One extra read, only on this path.
  const units = await scopedRepo(Unit, principal, { includeArchived: true })
    .find({ _id: { $in: relations.map((r) => toObjectId(r.unitId)) } })
    .lean<UnitDocLean[]>();
  const views = new Map((await viewsOf(principal, units, false)).map((v) => [v.id, v]));
  return relations.map((r) => {
    const v = views.get(r.unitId);
    return {
      id: r.unitId,
      unitCode: r.unitCode,
      name: r.unit?.name ?? v?.name,
      city: r.unit?.city ?? v?.city,
      statusKey: r.unit?.statusKey ?? v?.statusKey,
      statusLabel: v?.status?.label,
      statusColor: v?.status?.color,
      state: r.state,
      via: r.enquiries,
    } satisfies LinkedUnit;
  });
}
