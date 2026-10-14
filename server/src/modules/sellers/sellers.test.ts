import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { systemRepo } from '../../core/scope/system';
import { AuditLogs, actor, seedAll } from '../../test/factories';
import { useTestDb } from '../../test/db';
import { mkEnquiry, person } from '../../test/enquiries';
import { grant, revoke } from '../../test/people';
import { api, unitWorld } from '../../test/units';
import { FollowUp } from '../followups/followup.model';
import { Unit } from '../units/unit.model';
import { Seller, SellerProperty, SellerPropertyNegotiation, SellerPropertyWork, SellerStatusHistory } from './seller.model';

const app = buildApp();
const Sellers = systemRepo(Seller, 'test', 'fixtures');
const Properties = systemRepo(SellerProperty, 'test', 'fixtures');
const History = systemRepo(SellerStatusHistory, 'test', 'fixtures');
const Negotiations = systemRepo(SellerPropertyNegotiation, 'test', 'fixtures');
const Work = systemRepo(SellerPropertyWork, 'test', 'fixtures');
const Units = systemRepo(Unit, 'test', 'fixtures');
const FollowUps = systemRepo(FollowUp, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

type Who = { auth: Record<string, string>; user: { _id: unknown } };
const uid = (who: Who) => String(who.user._id);

/** Unit world (two branches, managers, OWN-scope reps, masters) plus the follow-up types sellers use. */
async function sellerWorld(app: Express) {
  const w = await unitWorld(app);
  const types = (await request(app).get(api('/masters?types=FOLLOWUP_TYPE')).set(w.admin.auth)).body.data.FOLLOWUP_TYPE as { _id: string; code: string }[];
  const ft = Object.fromEntries(types.map((t) => [t.code, t._id])) as Record<string, string>;
  return { ...w, ft };
}
type SW = Awaited<ReturnType<typeof sellerWorld>>;

const ALL_PASSED = { titleDeed: 'PASSED', encumbrance: 'PASSED', taxRecords: 'PASSED', siteInspection: 'PASSED', measurements: 'PASSED' };
const purchaseBody = () => ({ finalPrice: 2_400_000, purchaseDate: new Date().toISOString(), purchaseReference: 'AGREEMENT-001' });
const post = (who: Who, path: string, body: Record<string, unknown> = {}) => request(app).post(api(path)).set(who.auth).send(body);
const get = (who: Who, path: string) => request(app).get(api(path)).set(who.auth);

let n = 0;
/** Registers a seller plus their first proposed property in branch A, and returns both views. */
async function mkSeller(who: Who, w: SW, extra: { property?: Record<string, unknown>; body?: Record<string, unknown> } = {}) {
  const property = { name: `Plot ${++n}`, askingPrice: 2_500_000, city: 'Chennai', plotArea: 2400, propertyTypeId: w.m.property, locationId: w.m.locA, ...extra.property };
  const res = await post(who, '/sellers', { person: person(), branchId: w.A, property, ...extra.body });
  if (res.status !== 201) throw new Error(`createSeller failed ${res.status} ${JSON.stringify(res.body)}`);
  return { seller: res.body.data.seller, property: res.body.data.property };
}

async function expectOk(res: request.Response, status = 200) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body.data;
}

/** Seller verified + every check passed + approved. */
async function toApproved(who: Who, sellerId: string, propertyId: string) {
  await expectOk(await post(who, `/sellers/${sellerId}/status`, { to: 'VERIFIED', reason: 'KYC documents checked' }));
  await expectOk(await post(who, `/seller-properties/${propertyId}/verify`, { outcome: 'PASSED', checklist: ALL_PASSED, notes: 'All clear' }));
  await expectOk(await post(who, `/seller-properties/${propertyId}/approve`, { reason: 'Verified and priced correctly' }));
}
async function toPurchased(who: Who, sellerId: string, propertyId: string) {
  await toApproved(who, sellerId, propertyId);
  return expectOk(await post(who, `/seller-properties/${propertyId}/purchase`, purchaseBody()));
}
async function toReady(who: Who, sellerId: string, propertyId: string) {
  const bought = await toPurchased(who, sellerId, propertyId);
  await expectOk(await post(who, `/seller-properties/${propertyId}/refurbish`, { action: 'start', workNotes: 'Repaint and rewire', estimatedCost: 300_000 }));
  await expectOk(await post(who, `/seller-properties/${propertyId}/refurbish`, { action: 'complete', workNotes: 'Done', actualCost: 280_000 }));
  await expectOk(await post(who, `/seller-properties/${propertyId}/ready-to-sell`, { reason: 'Ready for buyers', expectedPrice: 3_200_000 }));
  return bought as { unitId: string; unitCode: string };
}

async function eligibleUnitIds(who: Who, enquiryId: string): Promise<string[]> {
  const res = await get(who, `/enquiries/${enquiryId}/eligible-units`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.data as { id: string }[]).map((u) => u.id);
}
async function mkOrdinaryUnit(who: Who, w: SW) {
  return expectOk(await post(who, '/units', { name: `Ordinary Unit ${++n}`, branchId: w.A }), 201) as Promise<{ id: string; unitCode: string }>;
}

// ---------------------------------------------------------------------------------

describe('seller registration', () => {
  it('registers a seller and their first proposed property together, with no Unit created', async () => {
    const w = await sellerWorld(app);
    const started = Date.now();
    const { seller, property } = await mkSeller(w.mgrA, w);

    expect(seller.sellerNo).toMatch(/^SEL-\d{6}$/);
    expect(seller.statusKey).toBe('REGISTERED');
    expect(property.sellerPropertyNo).toMatch(/^SPP-\d{6}$/);
    expect(property).toMatchObject({ statusKey: 'PROPOSED', sellerId: seller.id, eligibleForBuyers: false });
    // The whole point of the split: nothing enters inventory before a purchase.
    expect(property.unitId).toBeUndefined();
    expect(await Units.countDocuments({})).toBe(0);

    const detail = await expectOk(await get(w.mgrA, `/sellers/${seller.id}`));
    expect(detail.properties).toHaveLength(1);
    expect(detail.propertyCount).toBe(1);

    // Both records start their immutable history, stamped by the server with the actor.
    for (const [entityType, id, to] of [['seller', seller.id, 'REGISTERED'], ['sellerProperty', property.id, 'PROPOSED']] as const) {
      const rows = await History.find({ entityId: id }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entityType, toStatus: to, action: 'registered' });
      expect(rows[0]!.fromStatus).toBeUndefined();
      expect(String(rows[0]!.userId)).toBe(uid(w.mgrA));
      expect(rows[0]!.at.getTime()).toBeGreaterThanOrEqual(started - 1000);
      expect(rows[0]!.at.getTime()).toBeLessThanOrEqual(Date.now());
    }
    expect(await AuditLogs.countDocuments({ entityType: 'seller', action: 'create' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'sellerProperty', action: 'create' })).toBe(1);
  });

  it('never duplicates a person, and never registers the same person twice as a seller of a branch', async () => {
    const w = await sellerWorld(app);
    const p = person();
    const first = await expectOk(await post(w.mgrA, '/sellers', { person: p, branchId: w.A, property: { name: 'Plot A' } }), 201);

    // The persons module owns identity: a known phone is reported, never merged or re-created.
    const again = await post(w.mgrA, '/sellers', { person: p, branchId: w.A, property: { name: 'Plot B' } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PERSON_EXISTS');

    // Confirming the existing person is refused too: that person already IS a seller here.
    const dup = await post(w.mgrA, '/sellers', { personId: first.seller.personId, branchId: w.A, property: { name: 'Plot B' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'SELLER_EXISTS', details: { sellerId: first.seller.id } });

    // The way through is to add the property to the existing seller.
    const more = await expectOk(await post(w.mgrA, `/sellers/${first.seller.id}/properties`, { name: 'Plot B', askingPrice: 1_000_000 }), 201);
    expect(more).toMatchObject({ sellerId: first.seller.id, statusKey: 'PROPOSED' });
    expect(await Sellers.countDocuments({})).toBe(1);
    expect(await Properties.countDocuments({ sellerId: first.seller.id })).toBe(2);
  });

  it('validates the body and never accepts client-supplied status, unit or timestamps', async () => {
    const w = await sellerWorld(app);
    const bad = [
      { person: person(), branchId: w.A, property: {} },
      { person: person(), branchId: w.A, property: { name: 'X' }, bogus: 1 },
      { person: person(), branchId: 'nope', property: { name: 'X' } },
      { person: person(), branchId: w.A, property: { name: 'X', statusKey: 'READY_TO_SELL' } },
      { person: person(), branchId: w.A, property: { name: 'X', unitId: '64b0000000000000000000a1' } },
      { person: person(), branchId: w.A, property: { name: 'X', askingPrice: -5 } },
      { person: person(), personId: '64b0000000000000000000a1', branchId: w.A, property: { name: 'X' } },
    ];
    for (const body of bad) expect((await post(w.mgrA, '/sellers', body)).status, JSON.stringify(body)).toBe(400);
    expect(await Sellers.countDocuments({})).toBe(0);
  });

  it('needs a branch from a multi-branch user, and refuses a location of another branch', async () => {
    const w = await sellerWorld(app);
    const noBranch = await post(w.admin, '/sellers', { person: person(), property: { name: 'X' } });
    expect(noBranch.status).toBe(400);
    const wrongLoc = await post(w.admin, '/sellers', { person: person(), branchId: w.A, property: { name: 'X', locationId: w.m.locB } });
    expect(wrongLoc.status).toBe(400);
    expect(await Sellers.countDocuments({})).toBe(0);
  });
});

describe('branch and owner scoping', () => {
  it('keeps a branch out of another branch’s sellers and properties', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    expect((await post(w.mgrA, '/sellers', { person: person(), branchId: w.B, property: { name: 'Elsewhere' } })).status).toBe(403);
    expect((await get(w.mgrB, `/sellers/${seller.id}`)).status).toBe(404);
    expect((await get(w.mgrB, `/seller-properties/${property.id}`)).status).toBe(404);
    expect((await get(w.mgrB, '/sellers')).body.data).toHaveLength(0);
    expect((await get(w.mgrB, '/sellers/properties')).body.data).toHaveLength(0);
    expect((await post(w.mgrB, `/seller-properties/${property.id}/verify`, { outcome: 'FAILED' })).status).toBe(404);
    // The timeline is guarded the same way.
    expect((await get(w.mgrB, `/activities?refType=seller&refId=${seller.id}`)).status).toBe(404);
  });

  it('shows an OWN-scope rep only the sellers (and properties) assigned to them, and reassignment moves both', async () => {
    const w = await sellerWorld(app);
    const mine = await mkSeller(w.salesA, w); // a rep's own registration is assigned to them
    const theirs = await mkSeller(w.mgrA, w, { body: { assignedTo: uid(w.salesA2) } });
    expect(mine.seller.assignedTo).toBe(uid(w.salesA));

    const list = await expectOk(await get(w.salesA, '/sellers'));
    expect(list.map((s: { id: string }) => s.id)).toEqual([mine.seller.id]);
    const props = await expectOk(await get(w.salesA, '/sellers/properties'));
    expect(props.map((p: { id: string }) => p.id)).toEqual([mine.property.id]);
    expect((await get(w.salesA, `/seller-properties/${theirs.property.id}`)).status).toBe(404);
    expect((await post(w.salesA, `/seller-properties/${theirs.property.id}/negotiations`, { offeredPrice: 1 })).status).toBe(404);

    // A manager reassigns the rep's seller: the property follows in the same transaction.
    await expectOk(await post(w.mgrA, `/sellers/${mine.seller.id}/assign`, { assignedTo: uid(w.salesA2), reason: 'Rep moved territory' }));
    expect((await get(w.salesA, `/seller-properties/${mine.property.id}`)).status).toBe(404);
    expect((await get(w.salesA2, `/seller-properties/${mine.property.id}`)).status).toBe(200);
    expect(String((await Properties.findById(mine.property.id).lean())!.assignedTo)).toBe(uid(w.salesA2));
    // Reassigning without a reason is refused.
    expect((await post(w.mgrA, `/sellers/${mine.seller.id}/assign`, { assignedTo: uid(w.salesA) })).status).toBe(400);
  });
});

describe('permissions', () => {
  it('each gated step needs its own permission, checked on the API whatever the UI shows', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w, { body: { assignedTo: uid(w.salesA) } });
    // A rep may verify, but never approve, purchase, develop or release.
    await expectOk(await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'VERIFIED', reason: 'KYC checked' }));
    await expectOk(await post(w.salesA, `/seller-properties/${property.id}/verify`, { outcome: 'PASSED', checklist: ALL_PASSED }));
    expect((await post(w.salesA, `/seller-properties/${property.id}/approve`, { reason: 'looks fine' })).status).toBe(403);
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/approve`, { reason: 'Approved by manager' }));
    expect((await post(w.salesA, `/seller-properties/${property.id}/purchase`, purchaseBody())).status).toBe(403);
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/purchase`, purchaseBody()));
    expect((await post(w.salesA, `/seller-properties/${property.id}/refurbish`, { action: 'start' })).status).toBe(403);
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'start' }));
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'complete' }));
    expect((await post(w.salesA, `/seller-properties/${property.id}/ready-to-sell`, {})).status).toBe(403);
    expect((await Properties.findById(property.id).lean())!.statusKey).toBe('REFURBISHMENT');

    // The detail tells the rep exactly that, so the UI offers nothing the server would refuse.
    const view = await expectOk(await get(w.salesA, `/seller-properties/${property.id}`));
    expect(view.allowed).toMatchObject({ release: false, completeWork: false });
    const mgrView = await expectOk(await get(w.mgrA, `/seller-properties/${property.id}`));
    expect(mgrView.allowed.release).toBe(true);
  });

  it('verification of a property and of a seller both need sellers.verify', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.salesA, w);
    await revoke('SALES_EXECUTIVE', 'sellers.verify');
    const rep = await actor(app, 'SALES_EXECUTIVE', [w.A]);
    await expectOk(await post(w.mgrA, `/sellers/${seller.id}/assign`, { assignedTo: uid(rep), reason: 'handover' }));
    expect((await post(rep, `/seller-properties/${property.id}/verify`, { outcome: 'PASSED', checklist: ALL_PASSED })).status).toBe(403);
    const status = await post(rep, `/sellers/${seller.id}/status`, { to: 'VERIFIED', reason: 'trying it on' });
    expect(status.status).toBe(403);
    expect((await Sellers.findById(seller.id).lean())!.statusKey).toBe('REGISTERED');
  });

  it('refuses a user with no seller permissions at all, and a revoked one immediately', async () => {
    const w = await sellerWorld(app);
    const { property } = await mkSeller(w.mgrA, w);
    await revoke('SALES_EXECUTIVE', 'sellers.view', 'sellers.create', 'sellers.edit', 'sellers.verify');
    expect((await get(w.salesA, '/sellers')).status).toBe(403);
    expect((await get(w.salesA, `/seller-properties/${property.id}`)).status).toBe(403);
    expect((await post(w.salesA, '/sellers', { person: person(), property: { name: 'X' } })).status).toBe(403);
    await revoke('MANAGER', 'sellers.approve');
    expect((await post(w.mgrA, `/seller-properties/${property.id}/approve`, { reason: 'no longer allowed' })).status).toBe(403);
    await grant('MANAGER', 'sellers.approve');
  });
});

describe('seller status', () => {
  it('moves the relationship with a reason, history and an explicit move map', async () => {
    const w = await sellerWorld(app);
    const { seller } = await mkSeller(w.mgrA, w);
    expect((await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'VERIFIED' })).status).toBe(400); // reason required
    expect((await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'verify', reason: 'old style' })).status).toBe(400);
    const v = await expectOk(await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'VERIFIED', reason: 'KYC complete' }));
    expect(v.statusKey).toBe('VERIFIED');
    expect((await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'VERIFIED', reason: 'again' })).body.error.code).toBe('NO_CHANGE');
    await expectOk(await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'INACTIVE', reason: 'Stopped responding' }));
    // Reactivation returns to REGISTERED, so the seller must be verified again before any approval.
    const back = await expectOk(await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'REGISTERED', reason: 'Back in touch' }));
    expect(back.statusKey).toBe('REGISTERED');
    await expectOk(await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'REJECTED', reason: 'Not the owner' }));
    const stuck = await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'VERIFIED', reason: 'changed my mind' });
    expect(stuck.status).toBe(409);
    expect(stuck.body.error.code).toBe('STAGE_NOT_ALLOWED');
    // A rejected seller cannot offer new properties.
    expect((await post(w.mgrA, `/sellers/${seller.id}/properties`, { name: 'Another plot' })).body.error.code).toBe('SELLER_CLOSED');

    const history = await expectOk(await get(w.mgrA, `/sellers/${seller.id}`)).then((d) => d.history);
    expect(history.map((h: { fromStatus?: string; toStatus: string }) => `${h.fromStatus ?? '-'}>${h.toStatus}`)).toEqual(['->REGISTERED', 'REGISTERED>VERIFIED', 'VERIFIED>INACTIVE', 'INACTIVE>REGISTERED', 'REGISTERED>REJECTED']);
    expect(history[1]).toMatchObject({ reason: 'KYC complete', byUserId: uid(w.mgrA) });
    expect(history[1].byName).toBeTruthy();
  });
});

describe('verification, follow-ups and negotiation', () => {
  it('passes only when every check passed; a failed check keeps the property under verification', async () => {
    const w = await sellerWorld(app);
    const { property } = await mkSeller(w.mgrA, w);
    const halfway = await post(w.mgrA, `/seller-properties/${property.id}/verify`, { outcome: 'PASSED', checklist: { titleDeed: 'PASSED' } });
    expect(halfway.status).toBe(400);
    expect(halfway.body.error.details.map((d: { path: string }) => d.path)).toContain('checklist.encumbrance');

    const failed = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/verify`, { outcome: 'FAILED', checklist: { titleDeed: 'PASSED', encumbrance: 'FAILED' }, notes: 'Bank lien found' }));
    expect(failed.statusKey).toBe('UNDER_VERIFICATION');
    expect(failed.verification).toMatchObject({ outcome: 'FAILED', complete: false, verifiedById: uid(w.mgrA), notes: 'Bank lien found' });
    expect(failed.verification.checklist).toMatchObject({ titleDeed: 'PASSED', encumbrance: 'FAILED', taxRecords: 'PENDING' });

    // Re-verification reports only the checks it did; earlier results are kept.
    const passed = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/verify`, { outcome: 'PASSED', checklist: { encumbrance: 'PASSED', taxRecords: 'PASSED', siteInspection: 'PASSED', measurements: 'PASSED' } }));
    expect(passed.statusKey).toBe('VERIFIED');
    expect(passed.verification.complete).toBe(true);
    // Both attempts stay in the audit trail with their checklists.
    const audits = await AuditLogs.find({ entityType: 'sellerProperty', action: 'verify' }).sort({ at: 1 }).lean();
    expect(audits).toHaveLength(2);
    expect((audits[0]!.changes as Record<string, { to: unknown }>).outcome!.to).toBe('FAILED');
  });

  it('lets negotiation start before verification, and verification continue during it', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const r1 = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/negotiations`, { askingPrice: 2_500_000, offeredPrice: 2_100_000, notes: 'First call' }), 201);
    expect(r1.statusKey).toBe('NEGOTIATION');
    // Approval still needs verification, whatever the price talks say.
    expect((await post(w.mgrA, `/seller-properties/${property.id}/approve`, { reason: 'Price agreed' })).status).toBe(400);

    const v = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/verify`, { outcome: 'PASSED', checklist: ALL_PASSED }));
    expect(v.statusKey).toBe('NEGOTIATION'); // stays: the two run side by side
    expect(v.verification.complete).toBe(true);
    expect(v.blockers.approve).toEqual(['The seller has not been verified']);
    expect((await post(w.mgrA, `/seller-properties/${property.id}/approve`, { reason: 'Price agreed' })).body.error.details[0].path).toBe('seller');

    await expectOk(await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'VERIFIED', reason: 'KYC checked' }));
    const approved = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/approve`, { reason: 'Price agreed at 23L' }));
    expect(approved.statusKey).toBe('APPROVED');
    const history = approved.history.map((h: { action: string; fromStatus?: string; toStatus: string }) => `${h.action}:${h.fromStatus ?? '-'}>${h.toStatus}`);
    expect(history).toEqual(['registered:->PROPOSED', 'negotiation:PROPOSED>NEGOTIATION', 'verified:NEGOTIATION>NEGOTIATION', 'approved:NEGOTIATION>APPROVED']);
    expect(approved.history.at(-1)).toMatchObject({ reason: 'Price agreed at 23L', byUserId: uid(w.mgrA) });
  });

  it('keeps every negotiation round, immutably, with prices, dates, notes and outcomes', async () => {
    const w = await sellerWorld(app);
    const { property } = await mkSeller(w.mgrA, w);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/negotiations`, { askingPrice: 2_500_000, offeredPrice: 2_000_000, discussedOn: yesterday, notes: 'Opening' }), 201);
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/negotiations`, { counterPrice: 2_350_000, outcome: 'PENDING' }), 201);
    const last = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/negotiations`, { offeredPrice: 2_300_000, outcome: 'AGREED', notes: 'Shook hands' }), 201);
    expect(last.negotiations).toHaveLength(3);
    expect(last.negotiations[0]).toMatchObject({ offeredPrice: 2_300_000, outcome: 'AGREED', notes: 'Shook hands', byUserId: uid(w.mgrA) });
    expect(last.negotiations[2]).toMatchObject({ askingPrice: 2_500_000, offeredPrice: 2_000_000, discussedOn: yesterday });
    // Only the first round changes the status; the others are rounds within it.
    expect((await History.find({ entityId: property.id, action: 'negotiation' }).lean())).toHaveLength(1);

    expect((await post(w.mgrA, `/seller-properties/${property.id}/negotiations`, { outcome: 'PENDING' })).status).toBe(400); // no price
    expect((await post(w.mgrA, `/seller-properties/${property.id}/negotiations`, { offeredPrice: 1, discussedOn: new Date(Date.now() + 3 * 86_400_000).toISOString() })).status).toBe(400);
    await expect(Negotiations.updateOne({ sellerPropertyId: property.id }, { $set: { offeredPrice: 1 } })).rejects.toThrow(/append-only/);
  });

  it('schedules calls, site inspections and negotiation discussions as follow-ups on the seller or the property', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w, { body: { assignedTo: uid(w.salesA) } });
    const other = await mkSeller(w.mgrA, w);
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString();

    const visit = await expectOk(await post(w.salesA, '/followups', { sellerPropertyId: property.id, typeId: w.ft.SITE_VISIT, scheduledAt: when, notes: 'Inspect boundary' }), 201);
    expect(visit).toMatchObject({ sellerId: seller.id, sellerNo: seller.sellerNo, sellerPropertyId: property.id, sellerPropertyNo: property.sellerPropertyNo, assignedTo: uid(w.salesA), statusKey: 'PENDING' });
    await expectOk(await post(w.salesA, '/followups', { sellerId: seller.id, typeId: w.ft.CALL, scheduledAt: when }), 201);
    await expectOk(await post(w.mgrA, '/followups', { sellerPropertyId: property.id, typeId: w.ft.NEGOTIATION, scheduledAt: when }), 201);

    expect((await get(w.mgrA, `/followups?sellerId=${seller.id}`)).body.data).toHaveLength(3);
    expect((await get(w.mgrA, `/followups?sellerPropertyId=${property.id}`)).body.data).toHaveLength(2);
    // The activity lands on the seller and property timelines.
    const timeline = await expectOk(await get(w.mgrA, `/activities?refType=sellerProperty&refId=${property.id}`));
    expect(timeline.map((a: { type: string }) => a.type)).toContain('FOLLOWUP_SCHEDULED');

    // Anchors are checked: wrong seller for the property, an out-of-scope seller, two anchors at once.
    expect((await post(w.mgrA, '/followups', { sellerId: other.seller.id, sellerPropertyId: property.id, typeId: w.ft.CALL, scheduledAt: when })).status).toBe(400);
    expect((await post(w.salesA, '/followups', { sellerId: other.seller.id, typeId: w.ft.CALL, scheduledAt: when })).status).toBe(404);
    expect((await post(w.mgrB, '/followups', { sellerId: seller.id, typeId: w.ft.CALL, scheduledAt: when })).status).toBe(404);
    expect((await post(w.mgrA, '/followups', { sellerId: seller.id, clientId: seller.id, typeId: w.ft.CALL, scheduledAt: when })).status).toBe(400);
    // followups.create alone does not open Seller Management.
    await revoke('SALES_EXECUTIVE', 'sellers.view');
    expect((await post(w.salesA, '/followups', { sellerId: seller.id, typeId: w.ft.CALL, scheduledAt: when })).status).toBe(404);
    expect(await FollowUps.countDocuments({})).toBe(3);
  });
});

describe('approval', () => {
  it('is refused until every required check is complete', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const fromProposed = await post(w.mgrA, `/seller-properties/${property.id}/approve`, { reason: 'Too early' });
    expect(fromProposed.status).toBe(409);
    expect(fromProposed.body.error.code).toBe('STAGE_NOT_ALLOWED');

    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/verify`, { outcome: 'PASSED', checklist: ALL_PASSED }));
    // Seller not verified yet.
    expect((await post(w.mgrA, `/seller-properties/${property.id}/approve`, { reason: 'Try now' })).status).toBe(400);
    await expectOk(await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'VERIFIED', reason: 'KYC complete' }));
    expect((await post(w.mgrA, `/seller-properties/${property.id}/approve`, {})).status).toBe(400); // reason required
    const ok = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/approve`, { reason: 'Within budget' }));
    expect(ok.statusKey).toBe('APPROVED');
    expect(ok.allowed.purchase).toBe(true);
  });
});

describe('purchase completion and unit creation', () => {
  it('creates exactly one Unit, held UNDER_DEVELOPMENT, mapped from the property and linked both ways', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w, { body: { assignedTo: uid(w.salesA) }, property: { address: '12 Lake Road', bedrooms: 3, builtUpArea: 1800 } });
    expect((await post(w.mgrA, `/seller-properties/${property.id}/purchase`, purchaseBody())).status).toBe(409); // not approved
    expect(await Units.countDocuments({})).toBe(0);

    const bought = await toPurchased(w.mgrA, seller.id, property.id);
    expect(bought).toMatchObject({ statusKey: 'PURCHASED', unitCreated: true, purchasePrice: 2_400_000, purchaseReference: 'AGREEMENT-001', eligibleForBuyers: false });
    expect(bought.unitCode).toMatch(/^UNT-/);

    const units = await Units.find({}).lean();
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ unitCode: bought.unitCode, name: property.name, statusKey: 'UNDER_DEVELOPMENT', address: '12 Lake Road', bedrooms: 3, builtUpArea: 1800, plotArea: 2400, city: 'Chennai' });
    expect(String(units[0]!.branchId)).toBe(w.A);
    expect(String(units[0]!.propertyTypeId)).toBe(w.m.property);
    expect(units[0]!.expectedPrice).toBeUndefined(); // a purchase price is not a sale price
    expect(String(units[0]!.assignedTo)).toBe(uid(w.salesA)); // defaults to the seller's handler

    // History references the unit; the unit's creation is audited; the unit page links back.
    const purchased = (await History.find({ entityId: property.id, action: 'purchased' }).lean())[0]!;
    expect(purchased).toMatchObject({ fromStatus: 'APPROVED', toStatus: 'PURCHASED' });
    expect(purchased.refs.map((r) => `${r.type}:${String(r.id)}`)).toEqual([`seller:${seller.id}`, `unit:${bought.unitId}`]);
    expect(await AuditLogs.countDocuments({ entityType: 'unit', entityId: bought.unitId, action: 'create' })).toBe(1);
    const unitPage = await expectOk(await get(w.mgrA, `/units/${bought.unitId}`));
    expect(unitPage.acquisition).toMatchObject({ sellerPropertyId: property.id, sellerId: seller.id, sellerNo: seller.sellerNo, releasedToBuyers: false });
    expect(unitPage.allowed).toMatchObject({ changeStatus: false, archive: false });
    // Once a Unit exists the proposed record is frozen; edits go through the Unit.
    expect((await request(app).patch(api(`/seller-properties/${property.id}`)).set(w.mgrA.auth).send({ name: 'Renamed' })).body.error.code).toBe('PROPERTY_IS_UNIT');
  });

  it('is idempotent: repeating the purchase never creates a second Unit', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const first = await toPurchased(w.mgrA, seller.id, property.id);
    const again = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/purchase`, { ...purchaseBody(), finalPrice: 1 }));
    expect(again).toMatchObject({ unitCreated: false, unitId: first.unitId, purchasePrice: 2_400_000 });
    expect(await Units.countDocuments({})).toBe(1);
    expect(await History.countDocuments({ entityId: property.id, action: 'purchased' })).toBe(1);
  });

  it('creates exactly one Unit when two purchase requests race', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    await toApproved(w.mgrA, seller.id, property.id);
    const results = await Promise.all([1, 2, 3].map(() => post(w.mgrA, `/seller-properties/${property.id}/purchase`, purchaseBody())));
    for (const r of results) expect([200, 409], JSON.stringify(r.body)).toContain(r.status);
    expect(results.filter((r) => r.status === 200 && r.body.data.unitCreated)).toHaveLength(1);
    expect(await Units.countDocuments({})).toBe(1);
    expect(await History.countDocuments({ entityId: property.id, action: 'purchased' })).toBe(1);
  });

  it('rolls back completely when unit creation fails inside the transaction', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    await toApproved(w.mgrA, seller.id, property.id);
    // Occupy the unit code the purchase is about to take, so the Unit insert fails mid-transaction.
    await Units.create({ unitCode: 'UNT-000001', branchId: w.A, name: 'Squatter', statusId: w.st.available, statusKey: 'AVAILABLE', statusChangedAt: new Date() });
    const auditsBefore = await AuditLogs.countDocuments({});

    const res = await post(w.mgrA, `/seller-properties/${property.id}/purchase`, purchaseBody());
    expect(res.status).toBe(409);
    const p = (await Properties.findById(property.id).lean())!;
    expect(p.statusKey).toBe('APPROVED');
    expect(p.unitId).toBeUndefined();
    expect(p.purchasePrice).toBeUndefined(); // the claim was rolled back with everything else
    expect(await Units.countDocuments({})).toBe(1); // only the squatter
    expect(await History.countDocuments({ entityId: property.id, action: 'purchased' })).toBe(0);
    expect(await AuditLogs.countDocuments({})).toBe(auditsBefore);

    // The next attempt takes the next code and succeeds.
    const ok = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/purchase`, purchaseBody()));
    expect(ok.unitCreated).toBe(true);
  });

  it('validates the purchase and re-checks the prerequisites at the moment of purchase', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    await toApproved(w.mgrA, seller.id, property.id);
    for (const body of [{}, { ...purchaseBody(), finalPrice: -1 }, { ...purchaseBody(), purchaseReference: '' }, { ...purchaseBody(), unitId: 'x' }]) {
      expect((await post(w.mgrA, `/seller-properties/${property.id}/purchase`, body)).status, JSON.stringify(body)).toBe(400);
    }
    const future = await post(w.mgrA, `/seller-properties/${property.id}/purchase`, { ...purchaseBody(), purchaseDate: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    expect(future.status).toBe(400);
    // The seller relationship ended after approval: no purchase, and no Unit.
    await expectOk(await post(w.mgrA, `/sellers/${seller.id}/status`, { to: 'REJECTED', reason: 'Title dispute surfaced' }));
    expect((await post(w.mgrA, `/seller-properties/${property.id}/purchase`, purchaseBody())).status).toBe(400);
    expect(await Units.countDocuments({})).toBe(0);
  });
});

describe('refurbishment / development and ready to sell', () => {
  it('requires purchase, started AND completed development before release', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    expect((await post(w.mgrA, `/seller-properties/${property.id}/ready-to-sell`, {})).body.error.code).toBe('STAGE_NOT_ALLOWED');
    expect((await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'start' })).body.error.code).toBe('STAGE_NOT_ALLOWED');
    await toPurchased(w.mgrA, seller.id, property.id);
    expect((await post(w.mgrA, `/seller-properties/${property.id}/ready-to-sell`, {})).status).toBe(409);
    expect((await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'complete' })).status).toBe(409); // not started
    const started = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'start' }));
    expect(started.blockers.release).toEqual(['Refurbishment / development has not been completed']);
    const early = await post(w.mgrA, `/seller-properties/${property.id}/ready-to-sell`, {});
    expect(early.body.error.code).toBe('REFURBISHMENT_INCOMPLETE');
    expect((await Properties.findById(property.id).lean())!.statusKey).toBe('REFURBISHMENT');
    expect((await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'update' })).status).toBe(400); // nothing recorded
  });

  it('tracks the work, then releases: property READY_TO_SELL and unit AVAILABLE in one move, both with history', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const bought = await toPurchased(w.mgrA, seller.id, property.id);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'start', startedOn: twoDaysAgo, estimatedCost: 500_000, workNotes: 'Foundation and waterproofing', workAssignedTo: uid(w.salesA) }));
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'update', actualCost: 200_000, workNotes: 'Waterproofing done' }));
    const done = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'complete', actualCost: 480_000, workNotes: 'All work complete' }));
    expect(done).toMatchObject({ estimatedCost: 500_000, actualCost: 480_000, workAssignedTo: uid(w.salesA), statusKey: 'REFURBISHMENT' });
    expect(new Date(done.workStartedAt).toISOString()).toBe(twoDaysAgo);
    expect(done.work.map((x: { kind: string }) => x.kind)).toEqual(['COMPLETE', 'UPDATE', 'START']);
    expect((await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'update', workNotes: 'more' })).body.error.code).toBe('WORK_COMPLETED');
    await expect(Work.deleteOne({ sellerPropertyId: property.id })).rejects.toThrow(/append-only/);

    const before = Date.now();
    const released = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/ready-to-sell`, { reason: 'Development complete', expectedPrice: 3_200_000 }));
    expect(released).toMatchObject({ statusKey: 'READY_TO_SELL', eligibleForBuyers: true });
    const unit = (await Units.findById(bought.unitId).lean())!;
    expect(unit).toMatchObject({ statusKey: 'AVAILABLE', expectedPrice: 3_200_000 });

    // The unit's status history (the units convention: an immutable audit row per status change).
    const unitStatus = await AuditLogs.find({ entityType: 'unit', entityId: bought.unitId, action: 'status' }).lean();
    expect(unitStatus).toHaveLength(1);
    expect(unitStatus[0]!.changes).toMatchObject({ statusKey: { from: 'UNDER_DEVELOPMENT', to: 'AVAILABLE' } });
    expect(String(unitStatus[0]!.userId)).toBe(uid(w.mgrA));
    expect(unitStatus[0]!.reason).toMatch(/Released to buyers/);

    // The property's full status trail, in order, each with server time and actor.
    const trail = released.history as { action: string; fromStatus?: string; toStatus: string; at: string; byUserId: string; refs: { type: string }[] }[];
    expect(trail.map((h) => `${h.fromStatus ?? '-'}>${h.toStatus}`)).toEqual(['->PROPOSED', 'PROPOSED>VERIFIED', 'VERIFIED>APPROVED', 'APPROVED>PURCHASED', 'PURCHASED>REFURBISHMENT', 'REFURBISHMENT>READY_TO_SELL']);
    for (let i = 1; i < trail.length; i++) expect(new Date(trail[i]!.at).getTime()).toBeGreaterThanOrEqual(new Date(trail[i - 1]!.at).getTime());
    const last = trail.at(-1)!;
    expect(new Date(last.at).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(last.byUserId).toBe(uid(w.mgrA));
    expect(last.refs.map((r) => r.type)).toEqual(['seller', 'unit']);

    const unitPage = await expectOk(await get(w.mgrA, `/units/${bought.unitId}`));
    expect(unitPage.acquisition.releasedToBuyers).toBe(true);
    expect(unitPage.allowed.changeStatus).toBe(true);
  });

  it('does not bypass inventory rules: a sold or archived unit cannot be released', async () => {
    const w = await sellerWorld(app);
    for (const breakIt of [
      (id: string) => Units.updateOne({ _id: id }, { $set: { statusKey: 'SOLD', statusId: w.st.sold } }),
      (id: string) => Units.updateOne({ _id: id }, { $set: { isArchived: true } }),
    ]) {
      const { seller, property } = await mkSeller(w.mgrA, w);
      const bought = await toPurchased(w.mgrA, seller.id, property.id);
      await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'start' }));
      await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'complete' }));
      await breakIt(bought.unitId);
      const res = await post(w.mgrA, `/seller-properties/${property.id}/ready-to-sell`, {});
      expect(res.status).toBe(409);
      expect(['UNIT_NOT_AVAILABLE', 'UNIT_ARCHIVED']).toContain(res.body.error.code);
      expect((await Properties.findById(property.id).lean())!.statusKey).toBe('REFURBISHMENT');
      expect(await History.countDocuments({ entityId: property.id, action: 'readyToSell' })).toBe(0);
    }
  });

  it('the Units module cannot move a unit into or out of UNDER_DEVELOPMENT, or archive it, behind the workflow', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const bought = await toPurchased(w.mgrA, seller.id, property.id);
    const toAvailable = await post(w.admin, `/units/${bought.unitId}/status`, { statusId: w.st.available, reason: 'shortcut' });
    expect(toAvailable.status).toBe(409);
    expect(toAvailable.body.error.code).toBe('SELLER_OWNED');
    expect((await request(app).delete(api(`/units/${bought.unitId}`)).set(w.admin.auth)).body.error.code).toBe('SELLER_OWNED');
    const underDev = (await get(w.admin, '/masters?types=UNIT_STATUS')).body.data.UNIT_STATUS.find((m: { code: string }) => m.code === 'UNDER_DEVELOPMENT')._id;
    const ordinary = await mkOrdinaryUnit(w.mgrA, w);
    expect((await post(w.admin, `/units/${ordinary.id}/status`, { statusId: underDev, reason: 'hide it' })).body.error.code).toBe('SELLER_OWNED');
    expect((await Units.findById(bought.unitId).lean())!.statusKey).toBe('UNDER_DEVELOPMENT');
  });
});

describe('closing a proposal', () => {
  it('reject and withdraw need a reason, close the property, and reversing an approval needs sellers.approve', async () => {
    const w = await sellerWorld(app);
    const a = await mkSeller(w.mgrA, w, { body: { assignedTo: uid(w.salesA) } });
    expect((await post(w.salesA, `/seller-properties/${a.property.id}/reject`, {})).status).toBe(400);
    const rejected = await expectOk(await post(w.salesA, `/seller-properties/${a.property.id}/reject`, { reason: 'Encroachment on road' }));
    expect(rejected.statusKey).toBe('REJECTED');
    expect((await post(w.salesA, `/seller-properties/${a.property.id}/verify`, { outcome: 'FAILED' })).body.error.code).toBe('TERMINAL_STATUS');
    expect((await post(w.salesA, `/seller-properties/${a.property.id}/negotiations`, { offeredPrice: 1 })).body.error.code).toBe('TERMINAL_STATUS');

    const b = await mkSeller(w.mgrA, w, { body: { assignedTo: uid(w.salesA) } });
    await toApproved(w.mgrA, b.seller.id, b.property.id);
    expect((await post(w.salesA, `/seller-properties/${b.property.id}/reject`, { reason: 'Changed my mind' })).status).toBe(403);
    const withdrawn = await expectOk(await post(w.salesA, `/seller-properties/${b.property.id}/withdraw`, { reason: 'Seller sold elsewhere' }));
    expect(withdrawn.statusKey).toBe('WITHDRAWN');
    expect(withdrawn.history.at(-1)).toMatchObject({ action: 'withdrawn', fromStatus: 'APPROVED', reason: 'Seller sold elsewhere' });
    expect((await post(w.mgrA, `/seller-properties/${b.property.id}/purchase`, purchaseBody())).body.error.code).toBe('TERMINAL_STATUS');
    expect(await Units.countDocuments({})).toBe(0);
  });

  it('a seller with open proposals cannot be archived; once closed it can, and history is kept', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const blocked = await request(app).delete(api(`/sellers/${seller.id}`)).set(w.mgrA.auth);
    expect(blocked.body.error.code).toBe('SELLER_HAS_OPEN_PROPERTIES');
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/withdraw`, { reason: 'No longer selling' }));
    expect((await request(app).delete(api(`/sellers/${seller.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect((await get(w.mgrA, '/sellers')).body.data).toHaveLength(0);
    const archived = await expectOk(await get(w.mgrA, '/sellers?isArchived=true'));
    expect(archived.map((s: { id: string }) => s.id)).toEqual([seller.id]);
    expect(await History.countDocuments({ entityId: property.id })).toBe(2);
  });
});

describe('status history records', () => {
  it('are append-only for every caller', async () => {
    const w = await sellerWorld(app);
    const { seller } = await mkSeller(w.mgrA, w);
    await expect(History.updateOne({ entityId: seller.id }, { $set: { toStatus: 'VERIFIED' } })).rejects.toThrow(/append-only/);
    await expect(History.deleteOne({ entityId: seller.id })).rejects.toThrow(/append-only/);
  });
});

describe('buyer eligibility', () => {
  it('keeps a seller-originated unit out of the enquiry picker until Ready to Sell; ordinary units are unaffected', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const ordinary = await mkOrdinaryUnit(w.mgrA, w);
    const enquiry = await mkEnquiry(app, w.mgrA);

    const bought = await toPurchased(w.mgrA, seller.id, property.id);
    let ids = await eligibleUnitIds(w.mgrA, enquiry.id);
    expect(ids).toContain(ordinary.id);
    expect(ids).not.toContain(bought.unitId);

    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'start' }));
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'complete' }));
    ids = await eligibleUnitIds(w.mgrA, enquiry.id);
    expect(ids).not.toContain(bought.unitId);

    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/ready-to-sell`, {}));
    ids = await eligibleUnitIds(w.mgrA, enquiry.id);
    expect(ids).toEqual(expect.arrayContaining([ordinary.id, bought.unitId]));
  });

  it('refuses a direct API attempt to link or book a withheld unit, then allows both after release', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const bought = await toPurchased(w.mgrA, seller.id, property.id);
    const enquiry = await mkEnquiry(app, w.mgrA);

    const link = await post(w.mgrA, `/enquiries/${enquiry.id}/unit-interests`, { unitId: bought.unitId, status: 'INTERESTED' });
    expect(link.status, JSON.stringify(link.body)).toBe(409);
    expect(link.body.error.details.reason).toBe('SELLER_NOT_RELEASED');

    const booking = { enquiryId: enquiry.id, unitId: bought.unitId, salespersonId: uid(w.mgrA), bookingDate: new Date().toISOString() };
    const book = await post(w.mgrA, '/bookings', booking);
    expect(book.status).toBe(409);
    expect(book.body.error.message).toMatch(/still being prepared/i);
    expect((await get(w.mgrA, `/units/${bought.unitId}`)).body.data.booking.allowed.book).toBe(false);

    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'start' }));
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/refurbish`, { action: 'complete' }));
    await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/ready-to-sell`, {}));

    await expectOk(await post(w.mgrA, `/enquiries/${enquiry.id}/unit-interests`, { unitId: bought.unitId, status: 'INTERESTED' }), 201);
    expect((await get(w.mgrA, `/units/${bought.unitId}`)).body.data.booking.allowed.book).toBe(true);
    await expectOk(await post(w.mgrA, '/bookings', booking), 201);
    // Released stock then follows the normal rules: booked means no longer eligible.
    expect(await eligibleUnitIds(w.mgrA, (await mkEnquiry(app, w.mgrA)).id)).not.toContain(bought.unitId);
  });

  it('withholds the unit from every caller, even one who cannot see the seller property behind it', async () => {
    // The unit is assigned to salesA2, but the seller (and so the property) is handled by salesA. An
    // eligibility check made in salesA2's own scope would not find the property and would let it through.
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w, { body: { assignedTo: uid(w.salesA) } });
    await toApproved(w.mgrA, seller.id, property.id);
    const bought = await expectOk(await post(w.mgrA, `/seller-properties/${property.id}/purchase`, { ...purchaseBody(), assignedTo: uid(w.salesA2) }));
    expect((await get(w.salesA2, `/seller-properties/${property.id}`)).status).toBe(404);
    expect((await get(w.salesA2, `/units/${bought.unitId}`)).status).toBe(200);

    const enquiry = await mkEnquiry(app, w.salesA2);
    expect(await eligibleUnitIds(w.salesA2, enquiry.id)).not.toContain(bought.unitId);
    const link = await post(w.salesA2, `/enquiries/${enquiry.id}/unit-interests`, { unitId: bought.unitId, status: 'INTERESTED' });
    expect(link.status).toBe(409);
    // A rep who cannot see the seller does not get its purchase details on the unit page either.
    expect((await get(w.salesA2, `/units/${bought.unitId}`)).body.data.acquisition).toBeNull();
  });
});

describe('reports and documents', () => {
  it('lists seller properties as a report through the same scope and filter', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    await mkSeller(w.mgrA, w);
    const bought = await toReady(w.mgrA, seller.id, property.id);
    const report = await expectOk(await get(w.mgrA, '/reports/seller-properties?hasUnit=true'));
    expect(report.summary.total).toBe(1);
    expect(report.rows[0]).toMatchObject({ id: property.id, statusKey: 'READY_TO_SELL', unitCode: bought.unitCode, eligibleForBuyers: true });
    expect(report.columns).toContain('Released to buyers');
    expect(report.cells[0][report.columns.indexOf('Released to buyers')]).toBe('Yes');
    expect(report.summary.groups[0]).toMatchObject({ key: 'READY_TO_SELL', label: 'Ready to sell', count: 1 });
    expect((await get(w.mgrB, '/reports/seller-properties')).body.data.summary.total).toBe(0);
  });

  it('accepts documents on sellers and their properties, inheriting their access rules', async () => {
    const w = await sellerWorld(app);
    const { seller, property } = await mkSeller(w.mgrA, w);
    const types = (await get(w.mgrA, '/documents/entity-types')).body.data.map((t: { type: string }) => t.type);
    expect(types).toEqual(expect.arrayContaining(['seller', 'sellerProperty']));
    expect((await get(w.mgrA, `/documents?entityType=sellerProperty&entityId=${property.id}`)).status).toBe(200);
    expect((await get(w.mgrB, `/documents?entityType=seller&entityId=${seller.id}`)).status).toBe(404);
  });
});
