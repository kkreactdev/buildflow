import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { useTestDb } from '../../test/db';
import { seedAll } from '../../test/factories';
import { api, bookingWorld, mkBooking, mkEnquiry, mkUnit, negotiationEnquiry, revoke } from '../../test/bookings';
import { documentTypes, mkDoc } from '../../test/documents';
import { mkClient, mkExternal } from '../../test/referrals';

const app = buildApp();
useTestDb();
beforeEach(seedAll);

type Who = { auth: Record<string, string> };
const find = (who: Who, q: string, extra = '') => request(app).get(api(`/search?q=${encodeURIComponent(q)}${extra}`)).set(who.auth);
type Group = { type: string; items: { type: string; id: string; title: string; subtitle: string }[]; hasMore: boolean };
const groups = (r: request.Response) => r.body.data.results as Group[];
const ids = (r: request.Response) => groups(r).flatMap((g) => g.items.map((i) => i.id));

describe('matching', () => {
  it('finds each record type by its number, name or code and labels the groups', async () => {
    const w = await bookingWorld(app);
    const client = await mkClient(app, w.mgrA, 'Zephyrine Quill');
    const enq = await mkEnquiry(app, w.mgrA, {}, { name: 'Zephyrine Enquirer', phone: '+919811100001' });
    const unit = await mkUnit(app, w.mgrA, { name: 'Zephyr Heights' });
    const ref = await mkExternal(app, w.mgrA, 'Zephyr Referrer');
    const e2 = await negotiationEnquiry(app, w);
    const u2 = await mkUnit(app, w.mgrA);
    const booking = await mkBooking(app, w.mgrA, { unitId: u2.id, enquiryId: e2.id });

    const byName = await find(w.mgrA, 'zephyr');
    expect(byName.status).toBe(200);
    const types = groups(byName).map((g) => g.type);
    expect(types).toEqual(expect.arrayContaining(['client', 'enquiry', 'unit', 'referral']));
    expect(ids(byName)).toEqual(expect.arrayContaining([client.id, enq.id, unit.id, ref.id]));
    expect(groups(byName).find((g) => g.type === 'unit')!.items[0]).toMatchObject({ id: unit.id, title: 'Zephyr Heights' });

    expect(ids(await find(w.mgrA, client.clientNo))).toContain(client.id);
    expect(ids(await find(w.mgrA, enq.enquiryNo.toLowerCase()))).toContain(enq.id); // case-insensitive
    expect(ids(await find(w.mgrA, unit.unitCode))).toContain(unit.id);
    expect(ids(await find(w.mgrA, ref.referralNo))).toContain(ref.id);
    expect(ids(await find(w.mgrA, booking.bookingNo))).toContain(booking.id);
    expect(ids(await find(w.mgrA, u2.unitCode))).toContain(booking.id); // a booking is found by its unit code too
  }, 60_000);

  it('finds a record by the number alone, without its prefix or leading zeros', async () => {
    const w = await bookingWorld(app);
    const enq = await mkEnquiry(app, w.mgrA);
    const n = String(Number(enq.enquiryNo.replace(/\D/g, '')));
    expect(ids(await find(w.mgrA, n.length < 2 ? `0${n}` : n))).toContain(enq.id);
  });

  it('matches phone numbers by digits in any common format, only from 6 digits, and treats other text as a word match', async () => {
    const w = await bookingWorld(app);
    const enq = await mkEnquiry(app, w.mgrA, {}, { name: 'Phone Person', phone: '+919822233344' });
    expect(ids(await find(w.mgrA, '9822233344'))).toContain(enq.id);
    expect(ids(await find(w.mgrA, '98222 33344'))).toContain(enq.id);
    expect(ids(await find(w.mgrA, '+91 98222 33344'))).toContain(enq.id);
    expect(ids(await find(w.mgrA, '222333'))).toContain(enq.id);
    expect(ids(await find(w.mgrA, '98222'))).not.toContain(enq.id); // five digits: too short to be a phone search
  });

  it('is not a substring or regex scan: metacharacters are literal and mid-word text does not match', async () => {
    const w = await bookingWorld(app);
    const enq = await mkEnquiry(app, w.mgrA, {}, { name: 'Bartholomew Finch', phone: '+919833300001' });
    expect(ids(await find(w.mgrA, 'finch'))).toContain(enq.id); // word start
    expect(ids(await find(w.mgrA, 'artho'))).not.toContain(enq.id); // not mid-word
    for (const q of ['.*', '^B', '(a+)+$', '[a-z]+', 'B|F', 'a\\']) {
      const res = await find(w.mgrA, q);
      expect(res.status, q).toBe(200);
      expect(ids(res), q).not.toContain(enq.id);
    }
  });
});

describe('request validation', () => {
  it('rejects missing, too short, too long and unknown parameters; types and limits are bounded', async () => {
    const w = await bookingWorld(app);
    expect((await request(app).get(api('/search')).set(w.mgrA.auth)).status).toBe(400);
    expect((await find(w.mgrA, 'a')).status).toBe(400);
    expect((await find(w.mgrA, '   a   ')).status).toBe(400);
    expect((await find(w.mgrA, 'x'.repeat(65))).status).toBe(400);
    expect((await find(w.mgrA, 'abc', '&types=people')).status).toBe(400);
    expect((await find(w.mgrA, 'abc', '&limit=21')).status).toBe(400);
    expect((await find(w.mgrA, 'abc', '&page=0')).status).toBe(400);
    expect((await find(w.mgrA, 'abc', '&bogus=1')).status).toBe(400);
    expect((await find(w.mgrA, 'x'.repeat(64))).status).toBe(200);
  });

  it('requires a signed-in user', async () => {
    expect((await request(app).get(api('/search?q=abc'))).status).toBe(401);
  });

  it('returns an empty result set (not an error) when nothing matches', async () => {
    const w = await bookingWorld(app);
    const res = await find(w.mgrA, 'nothing-like-this');
    expect(res.status).toBe(200);
    expect(groups(res)).toEqual([]);
  });
});

describe('type filter and paging', () => {
  it('limits results per type, flags more, and pages through one type', async () => {
    const w = await bookingWorld(app);
    for (let i = 0; i < 7; i++) await mkEnquiry(app, w.mgrA, {}, { name: `Pagey Person ${i}`, phone: `+91981110100${i}` });
    await mkClient(app, w.mgrA, 'Pagey Client');
    const all = await find(w.mgrA, 'pagey', '&limit=3');
    const enquiryGroup = groups(all).find((g) => g.type === 'enquiry')!;
    expect(enquiryGroup.items).toHaveLength(3);
    expect(enquiryGroup.hasMore).toBe(true);
    expect(groups(all).find((g) => g.type === 'client')!.hasMore).toBe(false);

    const onlyEnq = await find(w.mgrA, 'pagey', '&types=enquiry&limit=3');
    expect(groups(onlyEnq).map((g) => g.type)).toEqual(['enquiry']);
    const p2 = await find(w.mgrA, 'pagey', '&types=enquiry&limit=3&page=2');
    const p3 = await find(w.mgrA, 'pagey', '&types=enquiry&limit=3&page=3');
    const seen = [...ids(onlyEnq), ...ids(p2), ...ids(p3)];
    expect(new Set(seen).size).toBe(7);
    expect(groups(p3)[0]!.hasMore).toBe(false);
    expect((await find(w.mgrA, 'pagey', '&page=2')).status).toBe(400); // paging needs one type
  });
});

describe('authorization and scope', () => {
  it('searches only the types the user may view; naming a forbidden type is a 403, and no type means nothing is revealed', async () => {
    const w = await bookingWorld(app);
    const client = await mkClient(app, w.mgrA, 'Guarded Gwen');
    await mkEnquiry(app, w.mgrA, {}, { name: 'Guarded Greg', phone: '+919844400001' });
    await revoke('MANAGER', 'clients.view');
    const res = await find(w.mgrA, 'guarded');
    expect(groups(res).map((g) => g.type)).toEqual(['enquiry']);
    expect(ids(res)).not.toContain(client.id);
    expect((await find(w.mgrA, 'guarded', '&types=client')).status).toBe(403);
    await revoke('MANAGER', 'enquiries.view');
    expect(groups(await find(w.mgrA, 'guarded'))).toEqual([]);
  });

  it('never returns records of another branch, however exactly they are named', async () => {
    const w = await bookingWorld(app);
    const inB = await mkEnquiry(app, w.mgrB, {}, { name: 'Secret Sally', phone: '+919855500001' });
    const unitB = await mkUnit(app, w.mgrB, { name: 'Secret Tower' });
    const clientB = await mkClient(app, w.mgrB, 'Secret Client');
    const refB = await mkExternal(app, w.mgrB, 'Secret Referrer');
    for (const q of ['secret', inB.enquiryNo, unitB.unitCode, clientB.clientNo, refB.referralNo, '9855500001', 'Secret Sally']) {
      expect(groups(await find(w.mgrA, q)), q).toEqual([]);
    }
    expect(ids(await find(w.mgrB, 'secret')).length).toBeGreaterThanOrEqual(4);
    expect(ids(await find(w.admin, 'secret')).length).toBeGreaterThanOrEqual(4);
  });

  it('OWN scope finds only records assigned to them, never the branch\'s others', async () => {
    const w = await bookingWorld(app);
    const mine = await mkEnquiry(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() }, { name: 'Ownly Mine', phone: '+919866600001' });
    const other = await mkEnquiry(app, w.mgrA, {}, { name: 'Ownly Other', phone: '+919866600002' });
    const res = await find(w.salesA, 'ownly');
    expect(ids(res)).toContain(mine.id);
    expect(ids(res)).not.toContain(other.id);
    expect(ids(await find(w.salesA, other.enquiryNo))).not.toContain(other.id);
    expect(ids(await find(w.salesA, '9866600002'))).not.toContain(other.id);
  });

  it('does not search archived enquiries, clients, units or referrals', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA, {}, { name: 'Archivable Anna', phone: '+919877700001' });
    expect(ids(await find(w.mgrA, 'archivable'))).toContain(e.id);
    await request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth);
    expect(ids(await find(w.mgrA, 'archivable'))).not.toContain(e.id);
  });

  it('does not query the person register: a person with no visible record cannot be found or confirmed', async () => {
    const w = await bookingWorld(app);
    await mkEnquiry(app, w.mgrB, {}, { name: 'Identity Ivan', phone: '+919888800001' });
    for (const q of ['identity ivan', '9888800001', '+919888800001']) {
      const res = await find(w.mgrA, q);
      expect(res.status).toBe(200);
      expect(groups(res)).toEqual([]);
      expect(JSON.stringify(res.body)).not.toMatch(/exist|duplicate|personId/i);
    }
  });
});

describe('documents', () => {
  it('returns metadata only and never a storage key, signed link or file content', async () => {
    const w = await bookingWorld(app);
    const types = await documentTypes(app, w.admin);
    const client = await mkClient(app, w.mgrA, 'Docs Owner');
    const doc = await mkDoc(app, w.mgrA, { entityType: 'client', entityId: client.id }, types.AGREEMENT!, 'alpha', { name: 'Sale agreement draft' });
    const res = await find(w.mgrA, 'agreement draft', '&types=document');
    expect(ids(res)).toContain(doc.id);
    const item = groups(res)[0]!.items[0]!;
    expect(Object.keys(item).sort()).toEqual(['id', 'subtitle', 'title', 'type']);
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey|signed|https?:|cloudinary|publicId|checksum|mimeType/i);
    expect(ids(await find(w.mgrA, doc.documentNo))).toContain(doc.id);
    expect(ids(await find(w.mgrB, 'agreement draft', '&types=document'))).not.toContain(doc.id);
    await revoke('MANAGER', 'documents.view');
    expect((await find(w.mgrA, 'agreement draft', '&types=document')).status).toBe(403);
  });

  it('OWN scope finds only documents they uploaded for records they can still see', async () => {
    const w = await bookingWorld(app);
    const types = await documentTypes(app, w.admin);
    const e = await mkEnquiry(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    const theirs = await mkDoc(app, w.salesA, { entityType: 'enquiry', entityId: e.id }, types.OTHER!, 'one', { name: 'Ownscope brochure' });
    const managers = await mkDoc(app, w.mgrA, { entityType: 'enquiry', entityId: e.id }, types.OTHER!, 'two', { name: 'Ownscope manager note' });
    const res = await find(w.salesA, 'ownscope', '&types=document');
    expect(ids(res)).toContain(theirs.id);
    expect(ids(res)).not.toContain(managers.id);
    // reassigned away: no longer reachable through search
    const re = await request(app).post(api(`/enquiries/${e.id}/assign`)).set(w.mgrA.auth).send({ assignedTo: w.salesA2.user._id.toHexString(), reason: 'rebalancing' });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect(ids(await find(w.salesA, 'ownscope', '&types=document'))).not.toContain(theirs.id);
  });
});
