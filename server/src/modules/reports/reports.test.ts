import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { resetEnvCache } from '../../config/env';
import { useTestDb } from '../../test/db';
import { AuditLogs, seedAll } from '../../test/factories';
import { api, bookingWorld, grant, mkBooking, mkEnquiry, mkUnit, negotiationEnquiry, releaseBookingApi, revoke } from '../../test/bookings';
import { mkExternal } from '../../test/referrals';

const app = buildApp();
useTestDb();
beforeEach(seedAll);

type Who = { auth: Record<string, string> };
const run = (who: Who, key: string, q = '') => request(app).get(api(`/reports/${key}${q}`)).set(who.auth);
/** The body arrives as one string whatever the content type (CSV on success, JSON on a refusal). */
const csv = async (who: Who, key: string, q = '') => {
  const res = await request(app).get(api(`/reports/${key}/export.csv${q}`)).set(who.auth).buffer(true).parse((r, cb) => { let d = ''; r.setEncoding('utf8'); r.on('data', (c) => (d += c)); r.on('end', () => cb(null, d)); });
  return { status: res.status, headers: res.headers, text: res.body as string };
};

describe('report catalogue and permissions', () => {
  it('lists only the reports the user holds both reports.view and the resource view permission for', async () => {
    const w = await bookingWorld(app);
    const keys = async () => ((await request(app).get(api('/reports')).set(w.mgrA.auth)).body.data as { key: string }[]).map((r) => r.key);
    expect(await keys()).toEqual(expect.arrayContaining(['enquiries', 'followups', 'sitevisits', 'units', 'bookings', 'referrals', 'funnel']));
    await revoke('MANAGER', 'bookings.view', 'referrals.view');
    const after = await keys();
    expect(after).not.toContain('bookings');
    expect(after).not.toContain('referrals');
    expect(after).toContain('enquiries');
  });

  it('refuses without reports.view (403), without the resource permission (403), unknown reports (404) and anonymous callers (401)', async () => {
    const w = await bookingWorld(app);
    expect((await request(app).get(api('/reports'))).status).toBe(401);
    expect((await request(app).get(api('/reports/enquiries'))).status).toBe(401);
    expect((await request(app).get(api('/reports/enquiries/export.csv'))).status).toBe(401);
    expect((await run(w.mgrA, 'nope')).status).toBe(404);
    await revoke('MANAGER', 'bookings.view');
    expect((await run(w.mgrA, 'bookings')).status).toBe(403);
    expect((await csv(w.mgrA, 'bookings')).status).toBe(403);
    await revoke('MANAGER', 'reports.export');
    expect((await csv(w.mgrA, 'enquiries')).status).toBe(403);
    expect((await run(w.mgrA, 'enquiries')).status).toBe(200); // viewing is separate from exporting
    await revoke('MANAGER', 'reports.view');
    expect((await run(w.mgrA, 'enquiries')).status).toBe(403);
  });
});

describe('list reports', () => {
  it('filters, sorts and paginates on the server and reports the total', async () => {
    const w = await bookingWorld(app);
    for (let i = 0; i < 5; i++) await mkEnquiry(app, w.mgrA);
    const p1 = (await run(w.mgrA, 'enquiries', '?limit=2&page=1&sort=enquiryNo')).body.data;
    expect(p1.rows).toHaveLength(2);
    expect(p1.meta).toMatchObject({ page: 1, limit: 2, total: 5 });
    expect(p1.summary.total).toBe(5);
    const p3 = (await run(w.mgrA, 'enquiries', '?limit=2&page=3&sort=enquiryNo')).body.data;
    expect(p3.rows).toHaveLength(1);
    expect((await run(w.mgrA, 'enquiries', '?limit=100000')).status).toBe(400);
  });

  it('is scoped like the module list: a branch manager never sees, counts or groups another branch, and cannot name it', async () => {
    const w = await bookingWorld(app);
    for (let i = 0; i < 3; i++) await mkEnquiry(app, w.mgrA);
    for (let i = 0; i < 2; i++) await mkEnquiry(app, w.mgrB);
    for (const key of ['enquiries', 'units', 'referrals']) {
      if (key === 'units') { await mkUnit(app, w.mgrA); await mkUnit(app, w.mgrB); await mkUnit(app, w.mgrB); }
      if (key === 'referrals') { await mkExternal(app, w.mgrA); await mkExternal(app, w.mgrB); await mkExternal(app, w.mgrB); }
      const a = (await run(w.mgrA, key)).body.data;
      const all = (await run(w.admin, key)).body.data;
      expect(all.summary.total, key).toBeGreaterThan(a.summary.total);
      expect(a.rows.every((r: { branch?: { id?: string } }) => !r.branch?.id || r.branch.id === w.A), key).toBe(true);
      expect((await run(w.mgrA, key, `?branchId=${w.B}`)).status, key).toBe(403);
    }
    expect((await run(w.admin, 'enquiries', `?branchId=${w.B}`)).body.data.summary.total).toBe(2);
  });

  it('OWN scope only sees assigned records', async () => {
    const w = await bookingWorld(app);
    await grant('SALES_EXECUTIVE', 'reports.view', 'reports.export');
    await mkEnquiry(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    await mkEnquiry(app, w.mgrA);
    expect((await run(w.salesA, 'enquiries')).body.data.summary.total).toBe(1);
    expect((await csv(w.salesA, 'enquiries')).text.trim().split(/\r?\n/)).toHaveLength(2); // header + one row
  });

  it('bookings: released bookings are reported as released and a status filter separates them', async () => {
    const w = await bookingWorld(app);
    const e1 = await negotiationEnquiry(app, w);
    const e2 = await negotiationEnquiry(app, w);
    const b1 = await mkBooking(app, w.mgrA, { unitId: (await mkUnit(app, w.mgrA)).id, enquiryId: e1.id });
    await mkBooking(app, w.mgrA, { unitId: (await mkUnit(app, w.mgrA)).id, enquiryId: e2.id });
    await releaseBookingApi(app, w.mgrA, b1.id);
    const active = (await run(w.mgrA, 'bookings', '?status=ACTIVE')).body.data;
    expect(active.summary.total).toBe(1);
    const released = (await run(w.mgrA, 'bookings', '?status=RELEASED')).body.data;
    expect(released.summary.total).toBe(1);
    expect(released.rows[0].isActive).toBe(false);
    expect((await run(w.mgrA, 'bookings')).body.data.summary.total).toBe(2);
    expect(JSON.stringify(active)).not.toMatch(/commission|payout/i);
  }, 60_000);

  it('referrals report has no commission, payout or status columns, and names only enquiries the caller may see', async () => {
    const w = await bookingWorld(app);
    const r = (await run(w.mgrA, 'referrals')).body.data;
    expect(r.columns.join('|')).not.toMatch(/commission|payout|status/i);
    const e = await mkEnquiry(app, w.mgrA);
    const ref = await mkExternal(app, w.mgrA);
    await request(app).post(api(`/referrals/${ref.id}/enquiries`)).set(w.mgrA.auth).send({ enquiryId: e.id });
    const own = (await run(w.mgrA, 'referrals')).body.data.rows[0];
    expect(own.enquiryNos).toEqual([e.enquiryNo]);
    await revoke('MANAGER', 'enquiries.view');
    const hidden = (await run(w.mgrA, 'referrals')).body.data.rows[0];
    expect(hidden.enquiryNos).toEqual([]); // the count is the referral's own fact; the numbers need enquiry visibility
  });
});

describe('funnel report', () => {
  it('states the difference between current stage counts and stage entries and needs enquiries.view', async () => {
    const w = await bookingWorld(app);
    await mkEnquiry(app, w.mgrA);
    const res = await run(w.mgrA, 'funnel');
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('funnel');
    expect(res.body.data.funnel.definitions.current).toBeTruthy();
    expect(res.body.data.funnel.definitions.entered).toMatch(/not the share/i);
    expect(res.body.data.rows.find((s: { systemKey: string }) => s.systemKey === 'NEW')).toMatchObject({ current: 1, entered: 1 });
    await revoke('MANAGER', 'enquiries.view');
    expect((await run(w.mgrA, 'funnel')).status).toBe(403);
    expect((await csv(w.mgrA, 'funnel')).status).toBe(403);
  });
});

describe('CSV export', () => {
  it('uses the same filters and scope as the report, stable headers, a BOM and a download name', async () => {
    const w = await bookingWorld(app);
    for (let i = 0; i < 3; i++) await mkEnquiry(app, w.mgrA);
    await mkEnquiry(app, w.mgrB);
    const res = await csv(w.mgrA, 'enquiries');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/enquiries-report\.csv/);
    expect(res.text.startsWith('﻿')).toBe(true);
    const lines = res.text.replace('﻿', '').trim().split(/\r?\n/);
    expect(lines).toHaveLength(1 + (await run(w.mgrA, 'enquiries')).body.data.summary.total);
    expect(lines[0]).toBe((await run(w.mgrA, 'enquiries')).body.data.columns.map((c: string) => (/[",]/.test(c) ? `"${c}"` : c)).join(','));
    expect((await csv(w.mgrA, 'enquiries', `?branchId=${w.B}`)).status).toBe(403);
      });

  it('neutralises spreadsheet formulas in exported text', async () => {
    const w = await bookingWorld(app);
    await mkEnquiry(app, w.mgrA, {}, { name: '=HYPERLINK("http://evil","x")', phone: '+919876500011' });
    await mkEnquiry(app, w.mgrA, {}, { name: '@SUM(1+1)', phone: '+919876500012' });
    await mkEnquiry(app, w.mgrA, {}, { name: '-2+3', phone: '+919876500013' });
    const text = (await csv(w.mgrA, 'enquiries')).text;
    for (const cell of text.split('\n').flatMap((l) => l.split(','))) expect(cell.replace(/^"/, '')).not.toMatch(/^[=@]/);
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'@SUM");
    expect(text).toContain("'-2+3");
  });

  it('refuses an over-large export with a normal JSON error before any data, and audits a real export', async () => {
    const w = await bookingWorld(app);
    for (let i = 0; i < 3; i++) await mkEnquiry(app, w.mgrA);
    process.env.EXPORT_MAX_ROWS = '2';
    resetEnvCache();
    try {
      const res = await csv(w.mgrA, 'enquiries');
      expect(res.status).toBe(413);
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(JSON.parse(res.text).error.code).toBe('EXPORT_TOO_LARGE');
    } finally {
      delete process.env.EXPORT_MAX_ROWS;
      resetEnvCache();
    }
    expect((await csv(w.mgrA, 'enquiries')).status).toBe(200);
    const audit = await AuditLogs.findOne({ entityType: 'export' }).sort({ _id: -1 }).lean();
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toMatch(/\+91\d{6}/); // no phone numbers in the audit trail
  });

  it('exports the funnel with both measures labelled', async () => {
    const w = await bookingWorld(app);
    await mkEnquiry(app, w.mgrA);
    const res = await csv(w.mgrA, 'funnel');
    expect(res.status).toBe(200);
    const header = res.text.replace('﻿', '').split('\n')[0]!;
    expect(header).toMatch(/in stage now/i);
    expect(header).toMatch(/entered during/i);
  });

  void Types;
});
