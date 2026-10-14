import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { systemRepo } from '../../core/scope/system';
import { addLocalDays, localDateString } from '../../lib/time';
import { useTestDb } from '../../test/db';
import { Activities, makeUser, seedAll } from '../../test/factories';
import { api, bookingWorld, createBookingApi, grant, mkBooking, mkEnquiry, mkUnit, negotiationEnquiry, releaseBookingApi, revoke, type BW } from '../../test/bookings';
import { createFollowUpApi, inMinutes } from '../../test/enquiries';
import { readyEnquiry, mkVisit } from '../../test/sitevisits';
import { setStatus } from '../../test/units';
import { Enquiry, EnquiryStageHistory } from '../enquiries/enquiry.model';
import { Booking } from '../bookings/booking.model';
import { FollowUp } from '../followups/followup.model';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import { getEnv } from '../../config/env';

const app = buildApp();
const Enquiries = systemRepo(Enquiry, 'test', 'fixtures');
const Bookings = systemRepo(Booking, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const uid = (a: { user: { _id: Types.ObjectId } }) => a.user._id.toHexString();
const dash = (who: { auth: Record<string, string> }, path = 'summary', q = '') => request(app).get(api(`/dashboard/${path}${q}`)).set(who.auth);
const tz = () => getEnv().APP_TIMEZONE;
const today = () => localDateString(new Date(), tz());
/** Moves a record's creation time (raw write: createdAt is immutable through Mongoose). */
const setCreatedAt = (id: string, at: Date) => Enquiry.collection.updateOne({ _id: new Types.ObjectId(id) }, { $set: { createdAt: at } });

describe('empty data', () => {
  it('every number is zero and every section is present with its definitions', async () => {
    const w = await bookingWorld(app);
    const res = await dash(w.mgrA);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.range).toMatchObject({ days: 30, to: today(), timeZone: tz() });
    expect(d.range.from).toBe(addLocalDays(today(), -29));
    expect(d.enquiries).toMatchObject({ new: { value: 0, previous: 0 }, active: 0, converted: { value: 0, previous: 0, current: 0 } });
    expect(d.followUps).toMatchObject({ today: 0, missed: 0, upcoming: 0, open: 0 });
    expect(d.siteVisits).toMatchObject({ today: 0, upcoming: 0, overdue: 0, completed: { value: 0 } });
    expect(d.units).toMatchObject({ total: 0, available: 0, booked: 0, sold: 0, byStatus: [] });
    expect(d.bookings).toMatchObject({ active: 0, made: { value: 0 }, released: { value: 0 } });
    expect(d.clients.new.value).toBe(0);
    expect(d.referrals.total).toBe(0);
    expect(d.activities).toEqual([]);
    expect(Object.keys(d.definitions)).toEqual(expect.arrayContaining(['activeEnquiries', 'activeBookings', 'followUpsMissed', 'previous']));
    const f = (await dash(w.mgrA, 'funnel')).body.data;
    expect(f.stages.length).toBeGreaterThan(5);
    expect(f.stages.every((s: { current: number; entered: number }) => s.current === 0 && s.entered === 0)).toBe(true);
    expect((await dash(w.mgrA, 'sources')).body.data.rows).toEqual([]);
    expect((await dash(w.mgrA, 'performance')).body.data.rows).toEqual([]);
  });
});

describe('date range', () => {
  it('uses whole calendar days in the business time zone: the first instant of the first day is in, the first instant after the last day is out', async () => {
    const w = await bookingWorld(app);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await mkEnquiry(app, w.mgrA)).id);
    // Asia/Kolkata (+05:30): the local day 2026-03-10 is [2026-03-09T18:30Z, 2026-03-10T18:30Z)
    expect(tz()).toBe('Asia/Kolkata');
    await setCreatedAt(ids[0]!, new Date('2026-03-09T18:29:59.999Z')); // 9 Mar, 23:59:59.999 local: previous day
    await setCreatedAt(ids[1]!, new Date('2026-03-09T18:30:00.000Z')); // 10 Mar, 00:00 local: in
    await setCreatedAt(ids[2]!, new Date('2026-03-10T12:00:00.000Z')); // in
    await setCreatedAt(ids[3]!, new Date('2026-03-10T18:29:59.999Z')); // 10 Mar, 23:59:59.999 local: in
    await setCreatedAt(ids[4]!, new Date('2026-03-10T18:30:00.000Z')); // 11 Mar, 00:00 local: out
    const d = (await dash(w.mgrA, 'summary', '?from=2026-03-10&to=2026-03-10')).body.data;
    expect(d.range).toMatchObject({ from: '2026-03-10', to: '2026-03-10', days: 1, previousFrom: '2026-03-09', previousTo: '2026-03-09' });
    expect(d.enquiries.new).toEqual({ value: 3, previous: 1 });
    const wide = (await dash(w.mgrA, 'summary', '?from=2026-03-09&to=2026-03-11')).body.data;
    expect(wide.enquiries.new.value).toBe(5);
    expect(wide.range.days).toBe(3);
  });

  it('compares with the same number of days immediately before', async () => {
    const w = await bookingWorld(app);
    const a = await mkEnquiry(app, w.mgrA);
    const b = await mkEnquiry(app, w.mgrA);
    const c = await mkEnquiry(app, w.mgrA);
    await setCreatedAt(a.id, new Date('2026-03-12T05:00:00Z'));
    await setCreatedAt(b.id, new Date('2026-03-04T05:00:00Z')); // in the previous 7 days
    await setCreatedAt(c.id, new Date('2026-03-02T05:00:00Z')); // before that
    const d = (await dash(w.mgrA, 'summary', '?from=2026-03-09&to=2026-03-15')).body.data;
    expect(d.range).toMatchObject({ previousFrom: '2026-03-02', previousTo: '2026-03-08' });
    expect(d.enquiries.new).toEqual({ value: 1, previous: 2 });
  });

  it('rejects reversed, over-long, malformed and unknown parameters', async () => {
    const w = await bookingWorld(app);
    for (const q of ['?from=2026-03-10&to=2026-03-01', '?from=2025-01-01&to=2026-03-01', '?from=2026-02-30', '?from=10-03-2026', '?to=tomorrow', '?foo=bar', '?branchId=nope', '?assignedTo=nope']) {
      expect((await dash(w.mgrA, 'summary', q)).status, q).toBe(400);
    }
    expect((await dash(w.mgrA, 'summary', '?from=2026-01-01&to=2026-12-31')).status).toBe(200); // 365 days is allowed
  });
});

describe('metrics', () => {
  it('active enquiries are those before the final stage (from the workflow), never lost ones; new counts creation in the range', async () => {
    const w = await bookingWorld(app);
    const e1 = await mkEnquiry(app, w.mgrA);
    const e2 = await mkEnquiry(app, w.mgrA);
    const e3 = await mkEnquiry(app, w.mgrA);
    await mkEnquiry(app, w.mgrA).then(async (e) => request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)); // archived: counted nowhere
    await request(app).post(api(`/enquiries/${e2.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost });
    await Enquiries.updateOne({ _id: e3.id }, { $set: { stageCode: 'CONVERTED' } }); // fixture: converting is not an operation yet
    const d = (await dash(w.mgrA)).body.data;
    expect(d.enquiries.new.value).toBe(3);
    expect(d.enquiries.active).toBe(1); // only e1: lost and converted are not active
    expect(d.enquiries.converted.current).toBe(1);
    void e1;
  });

  it('follow-ups: today, missed and upcoming use the same definitions as the follow-up lists', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA, { assignedTo: uid(w.salesA) });
    const type = (await request(app).get(api('/masters?types=FOLLOWUP_TYPE')).set(w.admin.auth)).body.data.FOLLOWUP_TYPE[0]._id as string;
    await createFollowUpApi(app, w.mgrA, { enquiryId: e.id, typeId: type, scheduledAt: inMinutes(5) });
    await createFollowUpApi(app, w.mgrA, { enquiryId: e.id, typeId: type, scheduledAt: inMinutes(3 * 24 * 60) });
    const FollowUps = systemRepo(FollowUp, 'test', 'fixtures');
    await FollowUps.create({ branchId: new Types.ObjectId(w.A), personId: new Types.ObjectId(), personName: 'M', phoneE164: '+919000000000', enquiryId: new Types.ObjectId(e.id), enquiryNo: e.enquiryNo, assignedTo: w.salesA.user._id, typeId: new Types.ObjectId(type), statusId: new Types.ObjectId(), statusKey: 'MISSED', scheduledAt: new Date(Date.now() - 86_400_000) });
    const d = (await dash(w.mgrA)).body.data.followUps;
    const summary = (await request(app).get(api('/followups/summary')).set(w.mgrA.auth)).body.data;
    expect({ today: d.today, missed: d.missed, upcoming: d.upcoming, open: d.open }).toEqual(summary);
    expect(d.missed).toBe(1);
    expect(d.open).toBe(3);
  });

  it('site visits: today, upcoming and overdue (scheduled, time passed)', async () => {
    const w = await bookingWorld(app);
    const e1 = await readyEnquiry(app, w);
    const v1 = await mkVisit(app, w.mgrA, { enquiryId: e1.id });
    const e2 = await readyEnquiry(app, w);
    const v2 = await mkVisit(app, w.mgrA, { enquiryId: e2.id });
    const Visits = systemRepo(SiteVisit, 'test', 'fixtures');
    await Visits.updateOne({ _id: v1.id }, { $set: { scheduledAt: new Date(Date.now() - 3_600_000) } }); // overdue (and, normally, today)
    const d = (await dash(w.mgrA)).body.data.siteVisits;
    expect(d.overdue).toBe(1);
    expect(d.upcoming).toBe(1); // v2 is tomorrow
    void v2;
  });

  it('units by status: available, booked, sold and any other status', async () => {
    const w = await bookingWorld(app);
    const u1 = await mkUnit(app, w.mgrA);
    const u2 = await mkUnit(app, w.mgrA);
    const u3 = await mkUnit(app, w.mgrA);
    await mkUnit(app, w.mgrA);
    await setStatus(app, w.mgrA, u1.id, { statusId: w.st.sold });
    await setStatus(app, w.mgrA, u2.id, { statusId: w.st.hold });
    const e = await negotiationEnquiry(app, w);
    await mkBooking(app, w.mgrA, { unitId: u3.id, enquiryId: e.id });
    const d = (await dash(w.mgrA)).body.data.units;
    expect(d).toMatchObject({ total: 4, available: 1, booked: 1, sold: 1 });
    expect(d.byStatus.map((s: { status: { label: string }; count: number }) => [s.status.label, s.count]).sort()).toEqual([['Available', 1], ['Booked', 1], ['On hold', 1], ['Sold', 1]]);
  });

  it('active bookings never include released ones; made and released are counted separately', async () => {
    const w = await bookingWorld(app);
    const e1 = await negotiationEnquiry(app, w);
    const e2 = await negotiationEnquiry(app, w);
    const u1 = await mkUnit(app, w.mgrA);
    const u2 = await mkUnit(app, w.mgrA);
    const b1 = await mkBooking(app, w.mgrA, { unitId: u1.id, enquiryId: e1.id });
    await mkBooking(app, w.mgrA, { unitId: u2.id, enquiryId: e2.id });
    expect((await dash(w.mgrA)).body.data.bookings).toMatchObject({ active: 2, made: { value: 2 }, released: { value: 0 } });
    await releaseBookingApi(app, w.mgrA, b1.id);
    const d = (await dash(w.mgrA)).body.data.bookings;
    expect(d).toMatchObject({ active: 1, made: { value: 2 }, released: { value: 1 } });
    expect(await Bookings.countDocuments({ status: 'ACTIVE' })).toBe(1);
  }, 60_000);
});

describe('scope', () => {
  async function twoBranches() {
    const w = await bookingWorld(app);
    for (let i = 0; i < 3; i++) await mkEnquiry(app, w.mgrA, i === 0 ? { assignedTo: uid(w.salesA) } : {});
    for (let i = 0; i < 2; i++) await mkEnquiry(app, w.mgrB);
    await mkUnit(app, w.mgrA);
    await mkUnit(app, w.mgrB);
    await mkUnit(app, w.mgrB);
    return w;
  }

  it('BRANCH sees only its branch; ALL sees everything and can narrow; a foreign branch is refused', async () => {
    const w = await twoBranches();
    expect((await dash(w.mgrA)).body.data.enquiries.new.value).toBe(3);
    expect((await dash(w.mgrB)).body.data.enquiries.new.value).toBe(2);
    expect((await dash(w.admin)).body.data.enquiries.new.value).toBe(5);
    expect((await dash(w.admin, 'summary', `?branchId=${w.B}`)).body.data.enquiries.new.value).toBe(2);
    expect((await dash(w.mgrA)).body.data.units.total).toBe(1);
    expect((await dash(w.admin)).body.data.units.total).toBe(3);
    const widen = await dash(w.mgrA, 'summary', `?branchId=${w.B}`);
    expect(widen.status).toBe(403);
    expect(widen.body.data).toBeUndefined();
    for (const p of ['funnel', 'sources', 'performance']) expect((await dash(w.mgrA, p, `?branchId=${w.B}`)).status, p).toBe(403);
  });

  it('OWN sees only what is assigned to them, and a salesperson filter can never widen that', async () => {
    const w = await twoBranches();
    expect((await dash(w.salesA)).body.data.enquiries.new.value).toBe(1);
    expect((await dash(w.salesA, 'summary', `?assignedTo=${uid(w.salesA2)}`)).body.data.enquiries.new.value).toBe(0);
    expect((await dash(w.salesA, 'summary', `?assignedTo=${uid(w.salesA)}`)).body.data.enquiries.new.value).toBe(1);
    expect((await dash(w.salesA)).body.data.units.total).toBe(0); // the units are not assigned to them
    expect((await dash(w.mgrA, 'summary', `?assignedTo=${uid(w.salesA)}`)).body.data.enquiries.new.value).toBe(1); // a manager may narrow to one person
    expect((await dash(w.mgrA, 'summary', `?assignedTo=${uid(w.salesB)}`)).body.data.enquiries.new.value).toBe(0); // a person of another branch yields nothing, not their data
  });

  it('adding data in another branch never changes a branch manager\'s numbers', async () => {
    const w = await twoBranches();
    const before = (await dash(w.mgrA)).body.data;
    for (let i = 0; i < 3; i++) await mkEnquiry(app, w.mgrB);
    await mkUnit(app, w.mgrB);
    const after = (await dash(w.mgrA)).body.data;
    expect(after.enquiries).toEqual(before.enquiries);
    expect(after.units).toEqual(before.units);
  });
});

describe('permissions', () => {
  it('needs dashboard.view; sections the user may not view are absent and flagged, not zero', async () => {
    const w = await bookingWorld(app);
    expect((await request(app).get(api('/dashboard/summary'))).status).toBe(401);
    await revoke('MANAGER', 'bookings.view', 'referrals.view', 'clients.view');
    const d = (await dash(w.mgrA)).body.data;
    expect(d.bookings).toBeUndefined();
    expect(d.referrals).toBeUndefined();
    expect(d.clients).toBeUndefined();
    expect(d.allowed).toMatchObject({ bookings: false, referrals: false, clients: false, enquiries: true, units: true });
    await revoke('MANAGER', 'dashboard.view');
    expect((await dash(w.mgrA)).status).toBe(403);
    expect((await dash(w.mgrA, 'funnel')).status).toBe(403);
    await grant('MANAGER', 'dashboard.view');
    await revoke('MANAGER', 'enquiries.view');
    expect((await dash(w.mgrA, 'funnel')).status).toBe(403);
    expect((await dash(w.mgrA, 'sources')).status).toBe(403);
    expect((await dash(w.mgrA)).body.data.enquiries).toBeUndefined();
  });

  it('recent activity needs activities.view, hides records of resources the user cannot view, and is limited to their own actions for OWN scope', async () => {
    const w = await bookingWorld(app);
    const e = await negotiationEnquiry(app, w);
    const unit = await mkUnit(app, w.mgrA);
    await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: e.id });
    const types = (r: request.Response) => (r.body.data.activities as { type: string }[]).map((a) => a.type);
    expect(types(await dash(w.mgrA))).toContain('BOOKING_CREATED');
    await revoke('MANAGER', 'bookings.view');
    expect(types(await dash(w.mgrA))).not.toContain('BOOKING_CREATED'); // the feed cannot reveal a booking the user may not view
    expect(types(await dash(w.mgrA))).toContain('ENQUIRY_STAGE_CHANGED');
    await revoke('MANAGER', 'activities.view');
    expect((await dash(w.mgrA)).body.data.activities).toBeUndefined();
    // OWN: only their own actions (and only for resources they may view)
    const mine = await mkEnquiry(app, w.salesA, {});
    void mine;
    const own = (await dash(w.salesA)).body.data.activities as { description: string }[];
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((a) => !/booked|Unit /i.test(a.description))).toBe(true);
    const other = await Activities.countDocuments({ userId: w.mgrA.user._id });
    expect(other).toBeGreaterThan(own.length - 1);
  });
});

describe('funnel', () => {
  it('follows the configured workflow: current counts and stage entries are separate, labelled measures', async () => {
    const w = await bookingWorld(app);
    const a = await mkEnquiry(app, w.mgrA);
    const b = await mkEnquiry(app, w.mgrA);
    await mkEnquiry(app, w.mgrA);
    for (const to of ['CONTACTED', 'INTERESTED']) await request(app).post(api(`/enquiries/${a.id}/transition`)).set(w.mgrA.auth).send({ to });
    await request(app).post(api(`/enquiries/${b.id}/transition`)).set(w.mgrA.auth).send({ to: 'CONTACTED' });
    const f = (await dash(w.mgrA, 'funnel')).body.data;
    const by = Object.fromEntries(f.stages.map((s: { systemKey: string }) => [s.systemKey, s]));
    expect(by.NEW).toMatchObject({ current: 1, entered: 3 });
    expect(by.CONTACTED).toMatchObject({ current: 1, entered: 2 });
    expect(by.INTERESTED).toMatchObject({ current: 1, entered: 1 });
    expect(by.BOOKED).toMatchObject({ current: 0, entered: 0 });
    expect(f.totals.current).toBe(3);
    expect(f.definitions.current).toMatch(/right now/i);
    expect(f.definitions.entered).toMatch(/entered/i);
    expect(f.definitions.entered).toMatch(/not the share/i);
  });

  it('a renamed, reordered or added stage changes the funnel with no code change', async () => {
    const w = await bookingWorld(app);
    await mkEnquiry(app, w.mgrA);
    const stages = (await request(app).get(api('/workflow/stages')).set(w.admin.auth)).body.data as { _id: string; systemKey: string }[];
    const contacted = stages.find((s) => s.systemKey === 'CONTACTED')!;
    await request(app).patch(api(`/workflow/stages/${contacted._id}`)).set(w.admin.auth).send({ label: 'Reached out' });
    const added = await request(app).post(api('/workflow/stages')).set(w.admin.auth).send({ label: 'Brochure sent', afterSystemKey: 'CONTACTED' });
    expect(added.status).toBe(201);
    const keys = ((await dash(w.mgrA, 'funnel')).body.data.stages as { systemKey: string; label: string }[]);
    expect(keys.find((s) => s.systemKey === 'CONTACTED')!.label).toBe('Reached out');
    const order = keys.map((s) => s.systemKey);
    expect(order.indexOf(added.body.data.systemKey)).toBe(order.indexOf('CONTACTED') + 1);
    await mkEnquiry(app, w.mgrA);
    expect(((await dash(w.mgrA, 'funnel')).body.data.stages as { systemKey: string; current: number }[]).find((s) => s.systemKey === 'NEW')!.current).toBe(2);
  });

  it('stage entries respect the date range, branch and OWN scope (history has no owner, so it is restricted to visible enquiries)', async () => {
    const w = await bookingWorld(app);
    const mine = await mkEnquiry(app, w.mgrA, { assignedTo: uid(w.salesA) });
    const others = await mkEnquiry(app, w.mgrA);
    await mkEnquiry(app, w.mgrB);
    const inB = (await dash(w.admin, 'funnel')).body.data.stages.find((s: { systemKey: string }) => s.systemKey === 'NEW');
    expect(inB.entered).toBe(3);
    expect((await dash(w.mgrA, 'funnel')).body.data.stages.find((s: { systemKey: string }) => s.systemKey === 'NEW').entered).toBe(2);
    const own = (await dash(w.salesA, 'funnel')).body.data.stages.find((s: { systemKey: string }) => s.systemKey === 'NEW');
    expect(own).toMatchObject({ entered: 1, current: 1 }); // not the whole branch's history
    // move all history to the past: outside the default range
    await EnquiryStageHistory.collection.updateMany({}, { $set: { at: new Date('2025-01-01T00:00:00Z') } });
    expect((await dash(w.mgrA, 'funnel')).body.data.stages.find((s: { systemKey: string }) => s.systemKey === 'NEW')).toMatchObject({ entered: 0, current: 2 });
    expect((await dash(w.mgrA, 'funnel', '?from=2024-12-31&to=2025-01-02')).body.data.stages.find((s: { systemKey: string }) => s.systemKey === 'NEW').entered).toBe(2);
    void mine;
    void others;
  });

  it('enquiry-level filters narrow both measures; a filter that matches nothing yields zeros', async () => {
    const w = await bookingWorld(app);
    await mkEnquiry(app, w.mgrA, { sourceId: w.m.source });
    await mkEnquiry(app, w.mgrA, { sourceId: w.m.source2 });
    const get = async (q: string) => (await dash(w.mgrA, 'funnel', q)).body.data.stages.find((s: { systemKey: string }) => s.systemKey === 'NEW');
    expect(await get(`?sourceId=${w.m.source}`)).toMatchObject({ current: 1, entered: 1 });
    expect(await get(`?sourceId=${new Types.ObjectId()}`)).toMatchObject({ current: 0, entered: 0 });
  });
});

describe('sources and performance', () => {
  it('sources group enquiries created in the range by master source; booked-or-beyond counts the booking stage and later', async () => {
    const w = await bookingWorld(app);
    await mkEnquiry(app, w.mgrA, { sourceId: w.m.source });
    await mkEnquiry(app, w.mgrA, { sourceId: w.m.source });
    const booked = await negotiationEnquiry(app, w, { sourceId: w.m.source2 });
    await mkBooking(app, w.mgrA, { unitId: (await mkUnit(app, w.mgrA)).id, enquiryId: booked.id });
    const rows = (await dash(w.mgrA, 'sources')).body.data.rows as { source: { label: string }; created: number; bookedOrBeyond: number }[];
    expect(rows.find((r) => r.source.label === 'Website')).toMatchObject({ created: 2, bookedOrBeyond: 0 });
    expect(rows.find((r) => r.source.label === 'Walk-in')).toMatchObject({ created: 1, bookedOrBeyond: 1 });
    expect((await dash(w.mgrB, 'sources')).body.data.rows).toEqual([]);
  }, 60_000);

  it('performance lists only the people and records the user can see, and only the columns they may view', async () => {
    const w = await bookingWorld(app);
    await mkEnquiry(app, w.mgrA, { assignedTo: uid(w.salesA) });
    await mkEnquiry(app, w.mgrA, { assignedTo: uid(w.salesA) });
    await mkEnquiry(app, w.mgrA, { assignedTo: uid(w.salesA2) });
    await mkEnquiry(app, w.mgrB, { assignedTo: uid(w.salesB) });
    const rows = (r: request.Response) => r.body.data.rows as { userId: string; name: string; newEnquiries: number }[];
    const mgr = rows(await dash(w.mgrA, 'performance'));
    expect(mgr.map((r) => [r.userId, r.newEnquiries])).toEqual([[uid(w.salesA), 2], [uid(w.salesA2), 1]]);
    expect(rows(await dash(w.salesA, 'performance')).map((r) => r.userId)).toEqual([uid(w.salesA)]); // OWN: only themselves
    expect(rows(await dash(w.admin, 'performance')).length).toBe(3);
    const none = makeUser;
    void none;
    await revoke('MANAGER', 'bookings.view', 'sitevisits.view', 'followups.view');
    const limited = (await dash(w.mgrA, 'performance')).body.data;
    expect(limited.columns).toEqual({ newEnquiries: true, bookingsMade: false, visitsCompleted: false, missedFollowUps: false });
  });
});

void ({} as BW);
void createBookingApi;
