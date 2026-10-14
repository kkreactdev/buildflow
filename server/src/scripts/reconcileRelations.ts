import type { AddressInfo } from 'node:net';
import { buildApp } from '../app';
import { connectDb, disconnectDb } from '../config/db';
import { getEnv } from '../config/env';

/**
 * READ-ONLY relationship report (`npm run reconcile`): reads through the application's own API as the bootstrap Super Admin and
 * changes nothing. It lists where records are connected only indirectly (so a screen that looked them up by client id would miss
 * them) and where stored facts disagree (a unit marked Sold with no purchaser link, duplicate active bookings, ...). It links
 * records ONLY by stable ids and the (person, branch) client identity, never by similar names or phone text.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const out = (s = '') => process.stdout.write(`${s}\n`);

async function main() {
  process.env.IDENTITY_RATE_LIMIT_MAX = '5000';
  const env = getEnv();
  await connectDb({ uri: env.MONGODB_URI, requireReplicaSet: env.DB_REQUIRE_REPLICA_SET });
  const server = buildApp().listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  let token = '';
  const get = async (p: string) => { const r = await fetch(base + p, { headers: { Authorization: `Bearer ${token}` } }); return (await r.json()) as Json; };
  const all = async (p: string): Promise<Json[]> => { const rows: Json[] = []; for (let page = 1; page <= 50; page++) { const r = await get(`${p}${p.includes('?') ? '&' : '?'}limit=100&page=${page}`); rows.push(...(r.data ?? [])); if (rows.length >= (r.meta?.total ?? 0)) break; } return rows; };
  try {
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }) });
    if (!login.ok) throw new Error('Cannot sign in as the bootstrap Super Admin (check SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).');
    token = ((await login.json()) as Json).data.accessToken;

    const [enquiries, clients, units, bookings, followUps, visits] = await Promise.all([all('/enquiries?isArchived=false'), all('/clients'), all('/units'), all('/bookings'), all('/followups?isArchived=false'), all('/sitevisits?isArchived=false')]);
    const key = (personId: string, branchId: string) => `${personId}:${branchId}`;
    const clientOf = new Map(clients.map((c) => [key(c.personId, c.branchId), c]));
    const enquiryById = new Map(enquiries.map((e) => [e.id, e]));

    out('BuildFlow relationship reconciliation (read-only)\n');
    out(`Records: ${enquiries.length} enquiries, ${clients.length} clients, ${units.length} units, ${bookings.length} bookings, ${followUps.length} follow-ups, ${visits.length} site visits\n`);

    const withClient = enquiries.filter((e) => clientOf.has(key(e.personId, e.branchId)));
    out(`1. Enquiries whose person is a client of the same branch: ${withClient.length}${withClient.length ? ` (${withClient.slice(0, 8).map((e) => e.enquiryNo).join(', ')}${withClient.length > 8 ? ', ...' : ''})` : ''}`);
    const converted = enquiries.filter((e) => e.stageCode === 'CONVERTED');
    const convertedNoClient = converted.filter((e) => !clientOf.has(key(e.personId, e.branchId)));
    out(`   Converted enquiries without a client of that person in the branch: ${convertedNoClient.length}${convertedNoClient.length ? ` -> ${convertedNoClient.map((e) => e.enquiryNo).join(', ')}` : ''}`);

    const fuOnlyEnquiry = followUps.filter((f) => f.enquiryId && !f.clientId && enquiryById.has(f.enquiryId) && clientOf.has(key(enquiryById.get(f.enquiryId)!.personId, enquiryById.get(f.enquiryId)!.branchId)));
    const visitOnlyEnquiry = visits.filter((v) => !v.clientId && enquiryById.has(v.enquiryId) && clientOf.has(key(enquiryById.get(v.enquiryId)!.personId, enquiryById.get(v.enquiryId)!.branchId)));
    out(`2. Follow-ups of a client's enquiry that carry no client id (found through the enquiry): ${fuOnlyEnquiry.length}`);
    out(`   Site visits of a client's enquiry that carry no client id: ${visitOnlyEnquiry.length}`);
    const bkNoClient = bookings.filter((b) => !b.clientId && clientOf.has(key(b.personId, b.branchId)));
    out(`3. Bookings whose person IS a client but which store no client id (older than the client): ${bkNoClient.length}${bkNoClient.length ? ` -> ${bkNoClient.slice(0, 10).map((b) => b.bookingNo).join(', ')}` : ''}`);
    out('   (the application now resolves these through the person identity; no data change is needed to display them)');

    const unitById = new Map(units.map((u) => [u.id, u]));
    const activeByUnit = new Map<string, Json[]>();
    for (const b of bookings.filter((x) => x.isActive)) activeByUnit.set(b.unitId, [...(activeByUnit.get(b.unitId) ?? []), b]);
    const dup = [...activeByUnit.entries()].filter(([, v]) => v.length > 1);
    out(`4. Units with more than one active booking (must be 0): ${dup.length}${dup.length ? ` -> ${dup.map(([u]) => unitById.get(u)?.unitCode ?? u).join(', ')}` : ''}`);
    const soldNoBooking = units.filter((u) => u.statusKey === 'SOLD' && !activeByUnit.has(u.id));
    out(`5. Units marked Sold with no active booking (purchaser cannot be determined; needs a business decision): ${soldNoBooking.length}${soldNoBooking.length ? ` -> ${soldNoBooking.map((u) => u.unitCode).join(', ')}` : ''}`);
    const bookedNoBooking = units.filter((u) => u.statusKey === 'BOOKED' && !activeByUnit.has(u.id));
    const availableWithBooking = units.filter((u) => u.statusKey === 'AVAILABLE' && activeByUnit.has(u.id));
    out(`6. Units marked Booked with no active booking: ${bookedNoBooking.length}${bookedNoBooking.length ? ` -> ${bookedNoBooking.map((u) => u.unitCode).join(', ')}` : ''}`);
    out(`   Units marked Available that have an active booking: ${availableWithBooking.length}${availableWithBooking.length ? ` -> ${availableWithBooking.map((u) => u.unitCode).join(', ')}` : ''}`);
    const missing = bookings.filter((b) => !unitById.has(b.unitId) || !enquiryById.has(b.enquiryId));
    out(`7. Bookings whose unit or enquiry is not found among live records (archived or missing): ${missing.length}${missing.length ? ` -> ${missing.map((b) => b.bookingNo).join(', ')}` : ''}`);
    const multi = new Map<string, Json[]>();
    for (const b of bookings.filter((x) => x.isActive)) multi.set(b.enquiryId, [...(multi.get(b.enquiryId) ?? []), b]);
    const manyForEnquiry = [...multi.entries()].filter(([, v]) => v.length > 1);
    out(`8. Enquiries with several ACTIVE bookings (legitimate when the units differ): ${manyForEnquiry.length}${manyForEnquiry.length ? ' -> ' + manyForEnquiry.map(([e, v]) => `${enquiryById.get(e)?.enquiryNo ?? e}: ${v.map((b) => `${b.bookingNo}/${b.unitCode}`).join(' + ')}${new Set(v.map((b) => b.unitId)).size < v.length ? '  !! SAME UNIT' : ''}`).join('; ') : ''}`);
    out('\nNothing was changed. Every finding above is for review; no backfill is proposed for items 1-3 and 8 (they are display-resolution only).');
  } finally {
    server.close();
    await disconnectDb();
  }
}
main().catch((e) => { process.stderr.write(`Reconciliation failed: ${String(e instanceof Error ? e.message : e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>')}\n`); process.exit(1); });
