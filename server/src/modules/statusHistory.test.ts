import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { systemRepo } from '../core/scope/system';
import { AuditLogs, seedAll } from '../test/factories';
import { useTestDb } from '../test/db';
import { createClientApi, freshPhone, mkEnquiry, transition } from '../test/enquiries';
import { api, mkUnit, setStatus, unitWorld } from '../test/units';
import { EnquiryStageHistory } from './enquiries/enquiry.model';

/**
 * Status history across the records Seller Management sits beside. Enquiries keep an immutable
 * EnquiryStageHistory; clients have no status field, so their state changes (created, category changed,
 * archived) are kept in the immutable audit log; units record every status change as an audit row. These
 * tests pin that each is written by the server, in the same transaction as the change, with actor and
 * time — and that a refused change writes nothing.
 */
const app = buildApp();
const StageHistory = systemRepo(EnquiryStageHistory, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

describe('status history: enquiries', () => {
  it('records each move with previous/new stage, actor, server time and reason; a refused move records nothing', async () => {
    const w = await unitWorld(app);
    const started = Date.now();
    const e = await mkEnquiry(app, w.mgrA);
    expect((await transition(app, w.mgrA, e.id, { to: 'CONTACTED', reason: 'Called back' })).status).toBe(200);
    // Skipping a stage is refused, and so leaves no history behind.
    expect((await transition(app, w.mgrA, e.id, { to: 'BOOKED' })).status).toBe(409);

    const rows = await StageHistory.find({ enquiryId: e.id }).sort({ at: 1, _id: 1 }).lean();
    expect(rows.map((r) => `${r.fromStage ?? '-'}>${r.toStage}:${r.direction}`)).toEqual(['->NEW:CREATE', 'NEW>CONTACTED:FORWARD']);
    expect(rows[1]).toMatchObject({ reason: 'Called back' });
    for (const r of rows) {
      expect(String(r.userId)).toBe(w.mgrA.user._id.toHexString());
      expect(r.at.getTime()).toBeGreaterThanOrEqual(started - 1000);
      expect(String(r.branchId)).toBe(w.A);
    }
    // The detail page reads the same trail.
    const detail = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data;
    expect(detail.stageHistory.map((h: { to: string }) => h.to)).toEqual(['NEW', 'CONTACTED']);
  });

  it('is append-only', async () => {
    const w = await unitWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await expect(StageHistory.updateOne({ enquiryId: e.id }, { $set: { toStage: 'BOOKED' } })).rejects.toThrow(/append-only/);
    await expect(StageHistory.deleteMany({ enquiryId: e.id })).rejects.toThrow(/append-only/);
  });
});

describe('status history: clients', () => {
  it('records creation, category change and archive in the immutable audit log with actor and time', async () => {
    const w = await unitWorld(app);
    const category = (await request(app).post(api('/masters/CLIENT_CATEGORY')).set(w.admin.auth).send({ label: 'Investor' })).body.data._id as string;
    const c = (await createClientApi(app, w.mgrA, { person: { name: 'History Client', phone: freshPhone() } })).body.data;
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ categoryId: category })).status).toBe(200);
    expect((await request(app).delete(api(`/clients/${c.id}`)).set(w.mgrA.auth)).status).toBe(204);

    const rows = await AuditLogs.find({ entityType: 'client', entityId: c.id }).sort({ at: 1, _id: 1 }).lean();
    expect(rows.map((r) => r.action)).toEqual(['create', 'category_changed', 'archive']);
    expect(rows[2]!.changes).toMatchObject({ isArchived: { from: false, to: true } });
    for (const r of rows) expect(String(r.userId)).toBe(w.mgrA.user._id.toHexString());
    await expect(AuditLogs.updateOne({ _id: rows[0]!._id }, { $set: { action: 'tampered' } })).rejects.toThrow(/append-only/);
  });
});

describe('status history: units', () => {
  it('records every status change with previous/new status, actor and reason; a refused change records nothing', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    expect((await setStatus(app, w.mgrA, u.id, { statusId: w.st.hold, reason: 'Owner visit' })).status).toBe(200);
    expect((await setStatus(app, w.mgrA, u.id, { statusId: w.st.booked })).status).toBe(409); // booking-owned
    const rows = await AuditLogs.find({ entityType: 'unit', entityId: u.id, action: 'status' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'Owner visit', changes: { statusKey: { from: 'AVAILABLE' } } });
    expect(String(rows[0]!.userId)).toBe(w.mgrA.user._id.toHexString());
  });
});
