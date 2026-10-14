import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app';
import { AuditLogs, Activities, principalWith, seedAll } from '../../test/factories';
import { scopedRepo } from '../../core/scope';
import { getEnv, resetEnvCache } from '../../config/env';
import { api, createClientApi, createPersonApi, freshPhone, lookup, peopleWorld, revoke } from '../../test/people';
import { useTestDb } from '../../test/db';
import { systemRepo } from '../../core/scope/system';
import { Client } from '../clients/client.model';
import { Person } from './person.model';

const app = buildApp();
const People = systemRepo(Person, 'test', 'fixtures');
const Clients = systemRepo(Client, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

describe('lookup: duplicate detection and the access model', () => {
  it('NONE for an unknown number; the caller\'s notation does not matter', async () => {
    const w = await peopleWorld(app);
    const res = await lookup(app, w.mgrA, '98765 43210');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'NONE', phoneE164: '+919876543210' });
  });

  it('invalid phone numbers are a 400 with a field-level message, never a guess', async () => {
    const w = await peopleWorld(app);
    for (const phone of ['abc', '12345', '0000000000', '98765432101', '']) {
      const res = await lookup(app, w.mgrA, phone);
      expect(res.status, phone).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].path).toBe('phone');
    }
    expect((await request(app).post(api('/persons/lookup')).set(w.mgrA.auth).send({})).status).toBe(400);
    expect((await request(app).post(api('/persons/lookup')).set(w.mgrA.auth).send({ phone: '9876543210', extra: 1 })).status).toBe(400);
  });

  it('VISIBLE_MATCH shows the existing person to someone related to it (any phone notation)', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Raj Kumar', phone: '9876543210', email: 'raj@example.com' });
    const res = await lookup(app, w.salesA, '+91-98765-43210');
    expect(res.body.data.status).toBe('VISIBLE_MATCH');
    expect(res.body.data.person).toMatchObject({ name: 'Raj Kumar', phoneE164: '+919876543210', phone: '+91 98765 43210', email: 'raj@example.com' });
    expect(res.body.data.clients).toEqual([]);
  });

  it('HIDDEN_MATCH reveals EXISTENCE ONLY: no name, no branch, no ids, nothing else', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Secret Sam', phone: '9876543210', email: 'sam@example.com', address: '1 Hidden Street' });
    const res = await lookup(app, w.mgrB, '9876543210');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'HIDDEN_MATCH', phoneE164: '+919876543210', canLink: true });
    expect(JSON.stringify(res.body)).not.toMatch(/Secret|Sam|sam@|Hidden Street/);
    // a user without persons.link is told they cannot link
    expect((await lookup(app, w.salesB, '9876543210')).body.data).toMatchObject({ status: 'HIDDEN_MATCH', canLink: false });
  });

  it('probing a number held by another branch leaves an audit trace (without the number)', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Target', phone: '9876543210' });
    await lookup(app, w.mgrB, '9876543210');
    const rows = await AuditLogs.find({ action: 'lookup_hidden_match' }).lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.userId)).toBe(w.mgrB.user._id.toHexString());
    expect(JSON.stringify(rows)).not.toContain('9876543210');
    // a normal visible match or a miss is not noise in the audit log
    await lookup(app, w.mgrA, '9876543210');
    await lookup(app, w.mgrA, freshPhone());
    expect(await AuditLogs.countDocuments({ action: 'lookup_hidden_match' })).toBe(1);
  });

  it('requires persons.lookup (401/403)', async () => {
    const w = await peopleWorld(app);
    expect((await request(app).post(api('/persons/lookup')).send({ phone: '9876543210' })).status).toBe(401);
    await revoke('SALES_EXECUTIVE', 'persons.lookup');
    expect((await lookup(app, w.salesA, '9876543210')).status).toBe(403); // the principal is rebuilt per request
  });

  it('ALL scope sees everything: it can never be a HIDDEN match', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Raj', phone: '9876543210' });
    expect((await lookup(app, w.admin, '9876543210')).body.data.status).toBe('VISIBLE_MATCH');
  });
});

describe('creating a person: created / existing / invalid are distinct outcomes', () => {
  it('201 with the created identity (phone stored normalized + display form)', async () => {
    const w = await peopleWorld(app);
    const res = await createPersonApi(app, w.mgrA, { name: ' Raj Kumar ', phone: '098765 43210', email: 'RAJ@Example.com', address: '12 Main Rd' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Raj Kumar', phoneE164: '+919876543210', phone: '+91 98765 43210', email: 'raj@example.com', address: '12 Main Rd', branchIds: [w.A] });
    const row = await People.findOne({ phoneE164: '+919876543210' }).lean();
    expect(row!.branchIds!.map(String)).toEqual([w.A]);
    expect(await AuditLogs.countDocuments({ entityType: 'person', action: 'create' })).toBe(1);
  });

  it('409 PERSON_EXISTS with the match when the same person already exists in view — no second person, no merge', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Raj Kumar', phone: '9876543210' });
    const res = await createPersonApi(app, w.mgrA, { name: 'Someone Else', phone: '+91 98765 43210' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERSON_EXISTS');
    expect(res.body.error.details).toMatchObject({ status: 'VISIBLE_MATCH', person: { name: 'Raj Kumar' } });
    expect(await People.countDocuments()).toBe(1);
    expect((await People.findOne({}).lean())!.name).toBe('Raj Kumar'); // not overwritten
  });

  it('409 PERSON_EXISTS (existence only) when the person exists solely in another branch', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Secret Sam', phone: '9876543210' });
    const res = await createPersonApi(app, w.mgrB, { name: 'Sam', phone: '9876543210' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ status: 'HIDDEN_MATCH', phoneE164: '+919876543210', canLink: true });
    expect(JSON.stringify(res.body)).not.toMatch(/Secret/);
    expect(await People.countDocuments()).toBe(1);
  });

  it('400 for invalid input', async () => {
    const w = await peopleWorld(app);
    const bad = [{ name: 'R', phone: '9876543210' }, { name: 'Raj', phone: 'nope' }, { name: 'Raj' }, { phone: '9876543210' }, { name: 'Raj', phone: '9876543210', email: 'not-an-email' }, { name: 'Raj', phone: '9876543210', phoneE164: '+1' }, { name: 'Raj', phone: '9876543210', branchIds: [] }];
    for (const body of bad) expect((await createPersonApi(app, w.mgrA, body)).status, JSON.stringify(body)).toBe(400);
    expect(await People.countDocuments()).toBe(0);
  });

  it('concurrent creation of the same number yields exactly ONE person', async () => {
    const w = await peopleWorld(app);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => createPersonApi(app, i % 2 ? w.mgrA : w.mgrB, { name: `Racer ${i}`, phone: ['9876543210', '+919876543210', '098765-43210'][i % 3] })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(11);
    expect(await People.countDocuments()).toBe(1);
    for (const r of results.filter((r) => r.status === 409)) expect(r.body.error.code).toBe('PERSON_EXISTS');
  });

  it('the database itself enforces phone uniqueness (not just the application)', async () => {
    await People.create({ name: 'One', phoneE164: '+919876543210', phone: '+91 98765 43210', branchIds: [] });
    await expect(People.create({ name: 'Two', phoneE164: '+919876543210', phone: 'x', branchIds: [] })).rejects.toMatchObject({ code: 11000 });
    await expect(People.create({ name: 'Bad', phoneE164: '9876543210', phone: 'x', branchIds: [] })).rejects.toThrow(); // not E.164
  });

  it('needs persons.create; a branch is required when the actor has several or all', async () => {
    const w = await peopleWorld(app);
    expect((await createPersonApi(app, w.salesA, { name: 'Raj', phone: '9876543210' })).status).toBe(403);
    expect((await request(app).post(api('/persons')).send({})).status).toBe(401);
    expect((await createPersonApi(app, w.admin, { name: 'Raj', phone: '9876543210' })).status).toBe(400); // ALL scope must choose
    const ok = await createPersonApi(app, w.admin, { name: 'Raj', phone: '9876543210', branchId: w.B });
    expect(ok.status).toBe(201);
    expect(ok.body.data.branchIds).toEqual([w.B]);
    expect((await createPersonApi(app, w.mgrA, { name: 'Xavier', phone: freshPhone(), branchId: w.B })).status).toBe(403); // not their branch
  });
});

describe('there is no unrestricted person search', () => {
  it('has no list, search or get-by-id endpoint', async () => {
    const w = await peopleWorld(app);
    const p = (await createPersonApi(app, w.mgrA, { name: 'Raj', phone: '9876543210' })).body.data;
    for (const path of ['/persons', '/persons?search=Raj', `/persons/${p.id}`, '/persons/search', '/persons?phone=9876543210']) {
      expect((await request(app).get(api(path)).set(w.admin.auth)).status, path).toBe(404);
    }
  });

  it('a person is reachable only through a branch relationship: scoped Person queries never cross branches', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'In A', phone: freshPhone() });
    await createPersonApi(app, w.mgrB, { name: 'In B', phone: freshPhone() });
    const asA = scopedRepo(Person, principalWith('BRANCH', [], [w.A]));
    expect((await asA.find().lean()).map((p) => p.name)).toEqual(['In A']);
    expect(await asA.countDocuments({ name: /B/ })).toBe(0);
    const asNobody = scopedRepo(Person, principalWith('BRANCH', [], []));
    expect(await asNobody.find().lean()).toEqual([]);
  });
});

describe('linking an existing person to a branch (explicit, authorized, audited)', () => {
  const link = (who: { auth: Record<string, string> }, body: Record<string, unknown>) => request(app).post(api('/persons/link')).set(who.auth).send(body);

  it('a manager links the person; it becomes visible to that branch; audit + timeline record why', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Raj Kumar', phone: '9876543210' });
    expect((await lookup(app, w.mgrB, '9876543210')).body.data.status).toBe('HIDDEN_MATCH');

    const res = await link(w.mgrB, { phone: '9876543210', reason: 'Raj is moving to our city' });
    expect(res.status).toBe(200);
    expect(res.body.data.linked).toBe(true);
    expect(res.body.data.person).toMatchObject({ name: 'Raj Kumar', branchIds: [w.B] }); // only the caller's own branch is disclosed
    expect((await lookup(app, w.salesB, '9876543210')).body.data.status).toBe('VISIBLE_MATCH');
    expect(await People.countDocuments()).toBe(1);

    const audit = await AuditLogs.findOne({ entityType: 'person', action: 'link' }).lean();
    expect(audit).toMatchObject({ reason: 'Raj is moving to our city' });
    expect(String(audit!.userId)).toBe(w.mgrB.user._id.toHexString());
    expect(String(audit!.branchId)).toBe(w.B);
    const act = await Activities.findOne({ type: 'PERSON_LINKED' }).lean();
    expect(String(act!.branchId)).toBe(w.B);
    // the original branch still sees it, and the ALL view shows both relationships
    expect((await People.findOne({}).lean())!.branchIds!.map(String).sort()).toEqual([w.A, w.B].sort());
  });

  it('is idempotent', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Raj', phone: '9876543210' });
    await link(w.mgrB, { phone: '9876543210', reason: 'first' });
    const again = await link(w.mgrB, { phone: '9876543210', reason: 'second' });
    expect(again.body.data.linked).toBe(false);
    expect(await AuditLogs.countDocuments({ action: 'link' })).toBe(1);
  });

  it('needs persons.link, a reason, a real number, and a branch the actor belongs to', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Raj', phone: '9876543210' });
    expect((await link(w.salesB, { phone: '9876543210', reason: 'please' })).status).toBe(403);
    expect((await request(app).post(api('/persons/link')).send({ phone: '9876543210', reason: 'x y z' })).status).toBe(401);
    expect((await link(w.mgrB, { phone: '9876543210' })).status).toBe(400);
    expect((await link(w.mgrB, { phone: '9876543210', reason: '  ' })).status).toBe(400);
    expect((await link(w.mgrB, { phone: freshPhone(), reason: 'does not exist' })).status).toBe(404);
    expect((await link(w.mgrB, { phone: '9876543210', reason: 'sneaky', branchId: w.A })).status).toBe(403);
    expect((await lookup(app, w.mgrB, '9876543210')).body.data.status).toBe('HIDDEN_MATCH'); // nothing leaked/linked
  });

  it('an ALL-scope admin must name the branch to link into', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Raj', phone: '9876543210' });
    expect((await link(w.admin, { phone: '9876543210', reason: 'support' })).status).toBe(400);
    expect((await link(w.admin, { phone: '9876543210', reason: 'support', branchId: w.B })).body.data.linked).toBe(true);
  });
});

describe('editing identity', () => {
  const patch = (who: { auth: Record<string, string> }, id: string, body: Record<string, unknown>) => request(app).patch(api(`/persons/${id}`)).set(who.auth).send(body);

  it('changes name/email/address, audits before/after, and refreshes the client search projection in EVERY branch', async () => {
    const w = await peopleWorld(app);
    const p = (await createPersonApi(app, w.mgrA, { name: 'Raj Kumar', phone: '9876543210' })).body.data;
    await createClientApi(app, w.mgrA, { personId: p.id });
    await request(app).post(api('/persons/link')).set(w.mgrB.auth).send({ phone: '9876543210', reason: 'moved' });
    await createClientApi(app, w.mgrB, { personId: p.id });

    const res = await patch(w.mgrA, p.id, { name: 'Rajkumar S', email: 'raj@x.com', address: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Rajkumar S', email: 'raj@x.com' });
    expect((await Clients.find({}).lean()).map((c) => c.personName)).toEqual(['Rajkumar S', 'Rajkumar S']);
    const audit = await AuditLogs.findOne({ entityType: 'person', action: 'update' }).lean();
    expect(audit!.changes).toMatchObject({ name: { from: 'Raj Kumar', to: 'Rajkumar S' } });
    expect(audit!.branchId).toBeUndefined(); // identity is company-wide
  });

  it('changing the phone keeps it unique and re-keys the projection; a clash is refused and never merges', async () => {
    const w = await peopleWorld(app);
    const a = (await createPersonApi(app, w.mgrA, { name: 'Aaron', phone: '9876543210' })).body.data;
    await createPersonApi(app, w.mgrB, { name: 'B secret', phone: '9123456789' });
    await createClientApi(app, w.mgrA, { personId: a.id });

    const clash = await patch(w.mgrA, a.id, { phone: '+91 91234 56789' }); // held by a person in a branch A cannot see
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('PHONE_TAKEN');
    expect(JSON.stringify(clash.body)).not.toMatch(/secret/);
    expect(await People.countDocuments()).toBe(2);

    const ok = await patch(w.mgrA, a.id, { phone: '9000000001' });
    expect(ok.body.data).toMatchObject({ phoneE164: '+919000000001', phone: '+91 90000 00001' });
    expect((await Clients.findOne({}).lean())!.phoneE164).toBe('+919000000001');
    expect((await patch(w.mgrA, a.id, { phone: 'bad' })).status).toBe(400);
  });

  it('only for people the caller can see, and with persons.edit', async () => {
    const w = await peopleWorld(app);
    const p = (await createPersonApi(app, w.mgrA, { name: 'Raj', phone: '9876543210' })).body.data;
    expect((await patch(w.mgrB, p.id, { name: 'Hacked' })).status).toBe(404); // other branch: invisible
    expect((await patch(w.salesA, p.id, { name: 'Hacked' })).status).toBe(403); // no persons.edit
    expect((await request(app).patch(api(`/persons/${p.id}`)).send({ name: 'x' })).status).toBe(401);
    expect((await patch(w.mgrA, p.id, {})).status).toBe(400);
    for (const bad of [{ branchIds: [] }, { phoneE164: '+1' }, { createdBy: 'x' }]) expect((await patch(w.mgrA, p.id, bad)).status).toBe(400);
    expect((await People.findOne({}).lean())!.name).toBe('Raj');
  });
});

describe('rate limiting of identity checks', () => {
  async function withLimit(max: number, windowSeconds: number, fn: () => Promise<void>) {
    const prev = { m: process.env.IDENTITY_RATE_LIMIT_MAX, w: process.env.IDENTITY_RATE_LIMIT_WINDOW_SECONDS };
    process.env.IDENTITY_RATE_LIMIT_MAX = String(max);
    process.env.IDENTITY_RATE_LIMIT_WINDOW_SECONDS = String(windowSeconds);
    resetEnvCache();
    try {
      await fn();
    } finally {
      for (const [k, v] of [['IDENTITY_RATE_LIMIT_MAX', prev.m], ['IDENTITY_RATE_LIMIT_WINDOW_SECONDS', prev.w]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetEnvCache();
    }
  }

  it('throttles repeated lookups per user with a generic 429 that reveals nothing', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Target', phone: '9876543210' });
    await withLimit(3, 60, async () => {
      for (let i = 0; i < 3; i++) expect((await lookup(app, w.mgrB, '9876543210')).status).toBe(200);
      const blocked = await lookup(app, w.mgrB, '9876543210');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' });
      expect(JSON.stringify(blocked.body)).not.toMatch(/9876543210|HIDDEN|PERSON|exists|branch/i);
      expect(blocked.headers['retry-after']).toBeTruthy();
      // the same budget covers the other ways to probe a number
      expect((await createPersonApi(app, w.mgrB, { name: 'Probe', phone: '9876543210' })).status).toBe(429);
      expect((await createClientApi(app, w.mgrB, { person: { name: 'Probe', phone: '9876543210' } })).status).toBe(429);
    });
  });

  it('is per user: one user hitting the limit does not block a colleague, even from the same IP', async () => {
    const w = await peopleWorld(app);
    await withLimit(2, 60, async () => {
      for (let i = 0; i < 2; i++) await lookup(app, w.mgrA, freshPhone());
      expect((await lookup(app, w.mgrA, freshPhone())).status).toBe(429);
      expect((await lookup(app, w.salesA, freshPhone())).status).toBe(200);
      expect((await lookup(app, w.mgrB, freshPhone())).status).toBe(200);
    });
  });

  it('a normal working pace is unaffected by the defaults', async () => {
    const w = await peopleWorld(app);
    delete process.env.IDENTITY_RATE_LIMIT_MAX;
    resetEnvCache();
    try {
      expect(getEnv().IDENTITY_RATE_LIMIT_MAX).toBe(30);
      expect(getEnv().IDENTITY_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
      for (let i = 0; i < 12; i++) expect((await lookup(app, w.mgrA, freshPhone())).status).toBe(200);
    } finally {
      process.env.IDENTITY_RATE_LIMIT_MAX = '10000';
      resetEnvCache();
    }
  });

  it('unauthenticated or unauthorized callers never reach (or consume) the limiter', async () => {
    const w = await peopleWorld(app);
    await withLimit(1, 60, async () => {
      for (let i = 0; i < 4; i++) expect((await request(app).post(api('/persons/lookup')).send({ phone: freshPhone() })).status).toBe(401);
      await revoke('SALES_EXECUTIVE', 'persons.lookup');
      for (let i = 0; i < 4; i++) expect((await lookup(app, w.salesA, freshPhone())).status).toBe(403);
      expect((await lookup(app, w.mgrA, freshPhone())).status).toBe(200); // budget untouched
    });
  });

  it('keeps auditing hidden-match probes (the limiter does not replace the audit trail)', async () => {
    const w = await peopleWorld(app);
    await createPersonApi(app, w.mgrA, { name: 'Target', phone: '9876543210' });
    await withLimit(5, 60, async () => {
      await lookup(app, w.mgrB, '9876543210');
    });
    expect(await AuditLogs.countDocuments({ action: 'lookup_hidden_match' })).toBe(1);
  });
});
