import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../../app';
import { connectDb, disconnectDb } from '../../config/db';
import { getEnv } from '../../config/env';
import { flagMissedFollowUps } from '../../jobs/missedFollowups';
import { remindUpcomingFollowUps } from '../../jobs/upcomingFollowups';
import { remindUpcomingVisits } from '../../jobs/siteVisitReminders';
import { addLocalDays, localDateStart, localDateString } from '../../lib/time';
import { Enquiry } from '../../modules/enquiries/enquiry.model';
import { FollowUp } from '../../modules/followups/followup.model';
import { SiteVisit } from '../../modules/sitevisits/sitevisit.model';
import type { Principal } from '../../core/permissions/principal';
import { backdate as backdateRecord } from './backdate';
import { BRANCHES, CLIENTS, DEMO_BRANCH_PREFIX, DEMO_EMAIL_DOMAIN, EMPLOYEES, ENQUIRIES, EXTERNAL_REFERRERS, LOCATIONS, MASTER_VALUES, TEMPLATES, UNITS, salesOf } from './demoData';

/**
 * Demo data for UI review. `npm run seed:demo` (add `-- --dry-run` to only check and plan).
 *
 * Safety: it writes ONLY through the application's own HTTP API (validation, permissions, transactions, unique indexes and
 * activity logging all apply), logged in as the bootstrap Super Admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. It never
 * deletes or updates existing records, and it refuses to run unless the target database name contains "demo" (or its exact name
 * is given in DEMO_SEED_ALLOW_DB). The only direct writes are date back-dating of records THIS RUN just created (see `backdate`).
 */
const DRY = process.argv.includes('--dry-run');
const say = (...parts: unknown[]) => process.stdout.write(`${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
const stats: Record<string, { created: number; skipped: number; failed: number }> = {};
const failures: string[] = [];
const bump = (module: string, k: 'created' | 'skipped' | 'failed', why?: string) => {
  (stats[module] ??= { created: 0, skipped: 0, failed: 0 })[k]++;
  if (k === 'failed' && why) failures.push(`${module}: ${why}`);
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let base = '';
let token = '';
const idOf = (x: Json) => String(x.id ?? x._id);

async function call(method: string, path: string, body?: unknown, auth = token): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}
const must = async (module: string, what: string, p: Promise<{ status: number; body: Json }>): Promise<Json | null> => {
  const r = await p;
  if (r.status >= 200 && r.status < 300) return r.body.data ?? {};
  bump(module, 'failed', `${what} -> ${r.status} ${r.body.error?.code ?? ''} ${r.body.error?.message ?? ''}`.trim());
  return null;
};
async function listAll(path: string): Promise<Json[]> {
  const out: Json[] = [];
  for (let page = 1; page <= 30; page++) {
    const r = await call('GET', `${path}${path.includes('?') ? '&' : '?'}limit=100&page=${page}`);
    if (r.status !== 200) break;
    out.push(...(r.body.data as Json[]));
    if (out.length >= (r.body.meta?.total ?? 0)) break;
  }
  return out;
}

const tz = () => getEnv().APP_TIMEZONE;
const minutes = (m: number) => new Date(Date.now() + m * 60_000);
const days = (d: number, hour = 11) => new Date(localDateStart(addLocalDays(localDateString(new Date(), tz()), d), tz()).getTime() + hour * 3_600_000);
const endOfToday = () => localDateStart(addLocalDays(localDateString(new Date(), tz()), 1), tz());

const created = new Set<string>();
let adminPrincipal: Principal;
const backdate = (model: Parameters<typeof backdateRecord>[0], id: string, set: Record<string, Date>) => backdateRecord(model, adminPrincipal, created, id, set);

async function main(): Promise<void> {
  process.env.IDENTITY_RATE_LIMIT_MAX = '5000'; // this process only (set before the environment is first read): the seed does many identity checks in a minute
  const env = getEnv();
  const dbName = new URL(env.MONGODB_URI.replace(/^mongodb(\+srv)?:/, 'http:')).pathname.slice(1);
  if (!dbName || !(dbName.toLowerCase().includes('demo') || process.env.DEMO_SEED_ALLOW_DB === dbName)) {
    throw new Error(`Refusing to seed database "${dbName || '(none)'}": its name must contain "demo" (or set DEMO_SEED_ALLOW_DB to its exact name).`);
  }
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required (the Super Admin the demo data is created as).');

  await connectDb({ uri: env.MONGODB_URI, requireReplicaSet: env.DB_REQUIRE_REPLICA_SET });
  const server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  say(`Target database: ${dbName}${DRY ? '  (dry run: nothing will be written)' : ''}`);

  try {
    const login = await call('POST', '/auth/login', { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }, '');
    if (login.status !== 200) throw new Error(`Cannot sign in as the bootstrap Super Admin (HTTP ${login.status}). Run "npm run seed" first, and check SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.`);
    token = login.body.data.accessToken;
    adminPrincipal = { userId: String(login.body.data.user.id), permissions: new Set<string>(login.body.data.permissions), dataScope: login.body.data.dataScope, branchIds: (login.body.data.branchIds ?? []).map(String) } as Principal;

    const existing = {
      branches: await listAll('/branches'), users: await listAll('/users'), enquiries: await listAll('/enquiries'), clients: await listAll('/clients'),
      units: await listAll('/units'), visits: await listAll('/sitevisits'), followUps: await listAll('/followups'), bookings: await listAll('/bookings'),
      referrals: await listAll('/referrals'), templates: await listAll('/whatsapp-templates'),
    };
    if (DRY) {
      const demoUsers = existing.users.filter((u) => String(u.email).endsWith(`@${DEMO_EMAIL_DOMAIN}`)).length;
      say('Existing records:', Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, v.length])), `| demo users: ${demoUsers}`);
      say(`Plan: ${BRANCHES.length} branches, ${EMPLOYEES.length} employees, ${ENQUIRIES.length} enquiries, ${CLIENTS.length} clients, ${UNITS.length} units, ${EXTERNAL_REFERRERS.length + 5} referrals, ${TEMPLATES.length} templates (+ visits, follow-ups, bookings per scenario).`);
      return;
    }

    // ---- branches ------------------------------------------------------------------------------------------------
    const branchId: string[] = [];
    for (const b of BRANCHES) {
      const found = existing.branches.find((x) => x.code === b.code);
      if (found) { branchId.push(idOf(found)); bump('branches', 'skipped'); continue; }
      const r = await must('branches', b.code, call('POST', '/branches', b));
      if (!r) throw new Error('Branch creation failed; cannot continue.');
      branchId.push(idOf(r)); bump('branches', 'created');
    }

    // ---- masters (only values that do not exist yet; locations per branch) ---------------------------------------------
    const types = [...Object.keys(MASTER_VALUES), 'LOCATION', 'FOLLOWUP_TYPE', 'UNIT_STATUS'];
    const masters = async () => (await call('GET', `/masters?types=${[...new Set(types)].join(',')}&includeInactive=true`)).body.data as Record<string, Json[]>;
    let m = await masters();
    const ensure = async (type: string, label: string, branch?: string) => {
      const found = (m[type] ?? []).find((x) => x.label === label && (branch ? String(x.branchId) === branch : true));
      if (found) { bump('masters', 'skipped'); return idOf(found); }
      const r = await must('masters', `${type}/${label}`, call('POST', `/masters/${type}`, { label, ...(branch ? { branchId: branch } : {}) }));
      if (!r) return '';
      bump('masters', 'created'); return idOf(r);
    };
    const mid: Record<string, string[]> = {};
    for (const [type, labels] of Object.entries(MASTER_VALUES)) { mid[type] = []; for (const l of labels) mid[type]!.push(await ensure(type, l)); }
    const locId: string[] = [];
    for (const l of LOCATIONS) locId.push(await ensure('LOCATION', l.name, branchId[l.branch]));
    m = await masters();
    const byCode = (type: string, code: string) => idOf(m[type]!.find((x) => x.code === code || x.systemKey === code)!);
    const ft = { call: byCode('FOLLOWUP_TYPE', 'CALL'), meeting: byCode('FOLLOWUP_TYPE', 'MEETING'), whatsapp: byCode('FOLLOWUP_TYPE', 'WHATSAPP') };
    const unitStatus = { sold: byCode('UNIT_STATUS', 'SOLD'), hold: mid.UNIT_STATUS![0]! };

    // ---- employees (random throw-away passwords: demo accounts are not meant for sign-in) ---------------------------------
    const roles = (await call('GET', '/roles?limit=100')).body.data as Json[];
    const roleId = (key: string) => idOf(roles.find((r) => r.key === key)!);
    const uid: Record<string, string> = {};
    for (const e of EMPLOYEES) {
      const email = `${e.key}@${DEMO_EMAIL_DOMAIN}`;
      const found = existing.users.find((u) => u.email === email);
      if (found) { uid[e.key] = idOf(found); bump('users', 'skipped'); continue; }
      const branchIds = 'branch' in e ? [branchId[e.branch]!] : [];
      const r = await must('users', email, call('POST', '/users', { name: e.name, email, phone: e.phone, password: randomBytes(18).toString('base64url'), roleId: roleId(e.role), branchIds, ...(branchIds[0] ? { primaryBranchId: branchIds[0] } : {}) }));
      if (r) { uid[e.key] = idOf(r); bump('users', 'created'); }
    }
    const salesId = (branch: 0 | 1, i: number) => uid[salesOf(branch)[i % 3]!]!;

    // ---- units ---------------------------------------------------------------------------------------------------------
    const unit: Record<string, { id: string; planned: string }> = {};
    for (const u of UNITS) {
      const found = existing.units.find((x) => x.name === u.name);
      if (found) { unit[u.name] = { id: idOf(found), planned: u.status }; bump('units', 'skipped'); continue; }
      const loc = locId[LOCATIONS.findIndex((l) => l.branch === u.branch) + (u.loc % 3)] ?? locId[0];
      const r = await must('units', u.name, call('POST', '/units', {
        name: u.name, branchId: branchId[u.branch], propertyTypeId: mid.PROPERTY_TYPE![u.type], buildingTypeId: mid.BUILDING_TYPE![u.building], locationId: loc,
        city: u.branch === 0 ? 'Chennai' : 'Coimbatore', state: 'Tamil Nadu', expectedPrice: u.price, bedrooms: u.bed, bathrooms: u.bath, builtUpArea: u.area,
        description: `${u.name}: ${u.bed ? `${u.bed} bedroom ` : ''}${['villa', 'apartment', 'plot', 'row house'][u.type]} in a ${['independent setting', 'gated community', 'high-rise tower'][u.building]}.`,
        assignedTo: salesId(u.branch as 0 | 1, 0),
      }));
      if (r) { unit[u.name] = { id: idOf(r), planned: u.status }; bump('units', 'created'); }
    }
    // sold / hold units (booked ones are set by their bookings below)
    for (const u of UNITS) {
      const x = unit[u.name];
      if (!x || (u.status !== 'SOLD' && u.status !== 'HOLD')) continue;
      const current = existing.units.find((e) => e.name === u.name);
      if (current && current.statusKey !== 'AVAILABLE') continue; // already moved on a previous run
      const r = await must('units', `${u.name} status`, call('POST', `/units/${x.id}/status`, { statusId: u.status === 'SOLD' ? unitStatus.sold : unitStatus.hold }));
      void r;
    }

    // ---- clients -------------------------------------------------------------------------------------------------------
    const clientIds: { id: string; branch: 0 | 1 }[] = [];
    for (const [i, c] of CLIENTS.entries()) {
      const found = existing.clients.find((x) => String(x.phoneE164 ?? x.phone ?? '').replace(/\D/g, '').endsWith(c.phone));
      if (found) { clientIds.push({ id: idOf(found), branch: c.branch }); bump('clients', 'skipped'); continue; }
      const r = await must('clients', c.name, call('POST', '/clients', { person: { name: c.name, phone: `+91${c.phone}`, email: c.email }, branchId: branchId[c.branch], assignedTo: salesId(c.branch, c.sales), notes: i % 3 === 0 ? 'Existing customer; prefers evening calls.' : undefined }));
      if (r) { clientIds.push({ id: idOf(r), branch: c.branch }); bump('clients', 'created'); }
    }

    // ---- enquiries and their scenarios --------------------------------------------------------------------------------
    const doneFU = new Set(existing.followUps.map((f) => String(f.notes ?? '')));
    const followUp = async (enquiryId: string | undefined, clientId: string | undefined, assignedTo: string, kind: 'today' | 'upcoming' | 'completed' | 'missed', tag: string, type: string) => {
      const notes = `Demo follow-up ${tag}`;
      if (doneFU.has(notes)) { bump('followups', 'skipped'); return; }
      const when = kind === 'today' ? new Date(Math.min(minutes(25).getTime(), endOfToday().getTime() - 120_000)) : kind === 'upcoming' ? days(1 + (tag.length % 5), 10 + (tag.length % 6)) : minutes(3);
      const r = await must('followups', tag, call('POST', '/followups', { ...(enquiryId ? { enquiryId } : { clientId }), typeId: type, scheduledAt: when.toISOString(), assignedTo, notes }));
      if (!r) return;
      bump('followups', 'created'); created.add(idOf(r));
      if (kind === 'completed') {
        await call('POST', `/followups/${idOf(r)}/complete`, { outcome: 'Spoke to the customer; shared brochure and next steps.' });
        await backdate(FollowUp, idOf(r), { scheduledAt: days(-(1 + (tag.length % 6)), 12) });
      } else if (kind === 'missed') {
        await backdate(FollowUp, idOf(r), { scheduledAt: days(-(1 + (tag.length % 4)), 15) });
      }
    };

    const unitFor = (branch: 0 | 1, nth: number, wanted: 'BOOKED' | 'AVAILABLE') => UNITS.filter((u) => u.branch === branch && u.status === wanted)[nth];
    const bookUsed = new Map<string, number>();
    const fuPlan: Array<'today' | 'upcoming' | 'completed' | 'missed'> = ['today', 'upcoming', 'completed', 'missed', 'upcoming', 'completed'];
    let fuIndex = 0;

    for (const e of ENQUIRIES) {
      const sales = salesId(e.branch, e.sales);
      const phone = `+91${e.phone}`;
      let enq = existing.enquiries.find((x) => String(x.phoneE164 ?? x.phone ?? '').replace(/\D/g, '').endsWith(e.phone));
      let enquiryId: string;
      if (enq) { enquiryId = idOf(enq); bump('enquiries', 'skipped'); } else {
        const locIdx = LOCATIONS.map((l, i) => ({ l, i })).filter((x) => x.l.branch === e.branch)[e.loc]!.i;
        const r = await must('enquiries', `#${e.n} ${e.name}`, call('POST', '/enquiries', {
          person: { name: e.name, phone, email: `enquiry${e.n}@${DEMO_EMAIL_DOMAIN}` }, branchId: branchId[e.branch], sourceId: mid.ENQUIRY_SOURCE![e.src], typeId: mid.ENQUIRY_TYPE![e.type],
          propertyTypeId: mid.PROPERTY_TYPE![e.prop], buildingTypeId: mid.BUILDING_TYPE![e.building], locationId: locId[locIdx], assignedTo: sales, notes: e.notes,
        }));
        if (!r) continue;
        enq = r; enquiryId = idOf(r); bump('enquiries', 'created'); created.add(enquiryId);
        if (e.ageDays > 0) await backdate(Enquiry, enquiryId, { createdAt: days(-e.ageDays, 10) });
      }
      const stage = String((await call('GET', `/enquiries/${enquiryId}`)).body.data?.stageCode ?? '');
      const move = async (to: string) => { const r = await call('POST', `/enquiries/${enquiryId}/transition`, { to }); if (r.status !== 200) bump('enquiries', 'failed', `#${e.n} -> ${to}: ${r.body.error?.message}`); };

      if (stage === 'NEW' && e.plan !== 'NEW') await move('CONTACTED');
      if ((stage === 'NEW' || stage === 'CONTACTED') && !['NEW', 'CONTACTED'].includes(e.plan)) await move('INTERESTED');

      // site visits ------------------------------------------------------------------------------------------------------
      const visits = existing.visits.filter((v) => String(v.enquiryId) === enquiryId);
      const wantsVisit = ['VISIT_UPCOMING', 'VISIT_TODAY', 'VISIT_OVERDUE', 'VISIT_DONE', 'VISIT_CANCELLED', 'NEGOTIATION', 'BOOKED', 'BOOKED_RELEASED'].includes(e.plan);
      let visitDone = visits.some((v) => v.statusKey === 'COMPLETED');
      if (wantsVisit && visits.length === 0) {
        const wanted = unitFor(e.branch, e.n % 2, 'AVAILABLE');
        const unitIds = wanted && unit[wanted.name] ? [unit[wanted.name]!.id] : [];
        const upcoming = e.plan === 'VISIT_UPCOMING';
        const when = e.plan === 'VISIT_TODAY' ? new Date(Math.min(minutes(40).getTime(), endOfToday().getTime() - 300_000)) : upcoming ? days(1 + (e.n % 5), 10 + (e.n % 5)) : minutes(5);
        const r = await must('sitevisits', `#${e.n}`, call('POST', '/sitevisits', { enquiryId, scheduledAt: when.toISOString(), unitIds, assignedTo: sales, notes: 'Demo site visit' }));
        if (r) {
          bump('sitevisits', 'created'); created.add(idOf(r));
          if (e.plan === 'VISIT_OVERDUE') await backdate(SiteVisit, idOf(r), { scheduledAt: days(-(1 + (e.n % 3)), 11) });
          if (e.plan === 'VISIT_CANCELLED') await call('POST', `/sitevisits/${idOf(r)}/cancel`, { reason: 'Customer asked to reschedule next month' });
          if (['VISIT_DONE', 'NEGOTIATION', 'BOOKED', 'BOOKED_RELEASED'].includes(e.plan)) {
            const at = days(-(1 + (e.n % 8)), 12);
            const done = await call('POST', `/sitevisits/${idOf(r)}/complete`, { feedback: 'Liked the layout and location; wants to discuss pricing.', completedAt: at.toISOString() });
            if (done.status === 200) { visitDone = true; await backdate(SiteVisit, idOf(r), { scheduledAt: new Date(at.getTime() - 3_600_000) }); } else bump('sitevisits', 'failed', `complete #${e.n}: ${done.body.error?.message}`);
          }
        }
      } else if (wantsVisit) bump('sitevisits', 'skipped');

      if (['NEGOTIATION', 'BOOKED', 'BOOKED_RELEASED'].includes(e.plan) && visitDone && stage !== 'NEGOTIATION' && stage !== 'BOOKED') await move('NEGOTIATION');

      // bookings ---------------------------------------------------------------------------------------------------------
      if (e.plan === 'BOOKED' || e.plan === 'BOOKED_RELEASED') {
        const has = existing.bookings.some((b) => String(b.enquiryId) === enquiryId);
        if (has) bump('bookings', 'skipped'); else {
          const nth = bookUsed.get(`${e.branch}`) ?? 0;
          const target = e.plan === 'BOOKED_RELEASED' ? UNITS.find((u) => u.branch === 1 && u.status === 'AVAILABLE')! : unitFor(e.branch, nth, 'BOOKED');
          if (e.plan === 'BOOKED') bookUsed.set(`${e.branch}`, nth + 1);
          const x = target && unit[target.name];
          if (!x) bump('bookings', 'failed', `no unit planned for enquiry #${e.n}`); else {
            const r = await must('bookings', `#${e.n}`, call('POST', '/bookings', { unitId: x.id, enquiryId, bookingDate: days(-(1 + (e.n % 6)), 15).toISOString(), salespersonId: sales, notes: 'Token advance received (demo).' }));
            if (r) {
              bump('bookings', 'created');
              if (e.plan === 'BOOKED_RELEASED') await must('bookings', `release #${e.n}`, call('POST', `/bookings/${idOf(r)}/release`, { reason: 'Customer could not arrange the funds (demo).' }));
            }
          }
        }
      }

      // lost --------------------------------------------------------------------------------------------------------------
      if (e.plan === 'LOST' && !['LOST'].includes(stage)) {
        const r = await call('POST', `/enquiries/${enquiryId}/lose`, { lostReasonId: mid.LOST_REASON![e.n % 3], note: 'Marked lost during demo data setup.' });
        if (r.status !== 200) bump('enquiries', 'failed', `lose #${e.n}: ${r.body.error?.message}`);
      }

      // a spread of follow-ups on about every second enquiry --------------------------------------------------------------------
      if (e.n % 2 === 0 && !['LOST', 'BOOKED_RELEASED'].includes(e.plan)) {
        const kind = fuPlan[fuIndex++ % fuPlan.length]!;
        await followUp(enquiryId, undefined, sales, kind, `E${String(e.n).padStart(2, '0')}-${kind}`, [ft.call, ft.meeting, ft.whatsapp][e.n % 3]!);
      }
    }
    // client follow-ups
    for (const [i, c] of clientIds.slice(0, 3).entries()) {
      const cl = CLIENTS[i]!;
      await followUp(undefined, c.id, salesId(cl.branch, cl.sales), (['today', 'upcoming', 'completed'] as const)[i]!, `C${i + 1}-client`, ft.call);
    }

    // ---- referrals -------------------------------------------------------------------------------------------------------
    const referrals = existing.referrals;
    const refKey = (v: Json) => String(v.phoneE164 ?? v.phone ?? '').replace(/\D/g, '');
    const createdRefs: string[] = [];
    for (const x of EXTERNAL_REFERRERS) {
      const found = referrals.find((r) => refKey(r).endsWith(x.phone));
      if (found) { bump('referrals', 'skipped'); createdRefs.push(idOf(found)); continue; }
      const r = await must('referrals', x.name, call('POST', '/referrals', { person: { name: x.name, phone: `+91${x.phone}` }, branchId: branchId[x.branch], assignedTo: salesId(x.branch, 0), notes: 'Channel partner (demo).' }));
      if (r) { bump('referrals', 'created'); createdRefs.push(idOf(r)); }
    }
    for (const c of clientIds.slice(3, 6)) {
      const r = await call('POST', `/referrals/from-client/${c.id}`, { assignedTo: salesId(c.branch, 1) });
      if (r.status === 201) { bump('referrals', 'created'); createdRefs.push(idOf(r.body.data)); } else if (r.status === 409 || r.status === 422) bump('referrals', 'skipped'); else bump('referrals', 'failed', `from-client -> ${r.status} ${r.body.error?.message}`);
    }
    for (const key of ['s0', 's3']) {
      const r = await call('POST', `/referrals/from-user/${uid[key]}`, {});
      if (r.status === 201) { bump('referrals', 'created'); createdRefs.push(idOf(r.body.data)); } else if (r.status === 409 || r.status === 422) bump('referrals', 'skipped'); else bump('referrals', 'failed', `from-user -> ${r.status} ${r.body.error?.message}`);
    }
    // link a few referrals to enquiries (idempotent: a repeat link is refused and counted as skipped)
    const enquiriesNow = await listAll('/enquiries');
    const referralsNow = await listAll('/referrals');
    for (const [i, refId] of createdRefs.slice(0, 6).entries()) {
      const target = enquiriesNow[i * 4];
      if (!target) continue;
      if ((referralsNow.find((x) => idOf(x) === refId)?.enquiryCount ?? 0) > 0) { bump('referral links', 'skipped'); continue; }
      const r = await call('POST', `/referrals/${refId}/enquiries`, { enquiryId: idOf(target) });
      if (r.status === 200 || r.status === 201) bump('referral links', 'created'); else bump('referral links', 'failed', `link -> ${r.status} ${r.body.error?.message}`);
    }

    // ---- WhatsApp templates (stored only; nothing is sent) --------------------------------------------------------------------
    for (const t of TEMPLATES) {
      if (existing.templates.some((x) => x.name === t.name)) { bump('whatsapp templates', 'skipped'); continue; }
      const category = idOf((m.WA_CATEGORY ?? (await masters()).WA_CATEGORY!).find((x) => x.label === t.category)!);
      const event = idOf((m.WA_EVENT ?? (await masters()).WA_EVENT!).find((x) => x.label === t.event)!);
      if (await must('whatsapp templates', t.name, call('POST', '/whatsapp-templates', { name: t.name, categoryId: category, eventId: event, body: t.body }))) bump('whatsapp templates', 'created');
    }

    // ---- the application's own jobs (internal notifications only; nothing external is sent) --------------------------------
    const missed = await flagMissedFollowUps(new Date());
    const upcomingF = await remindUpcomingFollowUps(new Date());
    const upcomingV = await remindUpcomingVisits(new Date());
    say(`Jobs run: ${missed.flagged} follow-ups flagged missed, ${upcomingF.reminded + upcomingV.reminded} reminders created.`);
  } finally {
    server.close();
    await disconnectDb();
  }

  say('\nModule'.padEnd(22), 'created  skipped  failed');
  for (const [k, v] of Object.entries(stats)) say(k.padEnd(21), String(v.created).padStart(7), String(v.skipped).padStart(8), String(v.failed).padStart(7));
  if (failures.length) say(`\nFailures (${failures.length}):\n - ${failures.slice(0, 25).join('\n - ')}`);
  void DEMO_BRANCH_PREFIX;
}

main().catch((err: unknown) => {
  process.stderr.write(`Demo seed failed: ${String(err instanceof Error ? err.message : err).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>')}\n`);
  process.exit(1);
});
