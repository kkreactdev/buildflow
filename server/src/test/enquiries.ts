import type { Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { actor, makeUser, PASSWORD, login } from './factories';
import { api, createClientApi, peopleWorld, freshPhone, grant, revoke } from './people';

export { api, createClientApi, freshPhone, grant, revoke };

type Who = { auth: Record<string, string> };

/** Two branches with their people, and one value of every master an enquiry references (+ a location per branch). */
export async function enquiryWorld(app: Express) {
  const w = await peopleWorld(app);
  const salesA2 = await actor(app, 'SALES_EXECUTIVE', [w.A]);
  const mk = async (type: string, label: string, branchId?: string) =>
    (await request(app).post(api(`/masters/${type}`)).set(w.admin.auth).send({ label, ...(branchId ? { branchId } : {}) })).body.data._id as string;
  const m = {
    source: await mk('ENQUIRY_SOURCE', 'Website'),
    source2: await mk('ENQUIRY_SOURCE', 'Walk-in'),
    type: await mk('ENQUIRY_TYPE', 'Purchase'),
    property: await mk('PROPERTY_TYPE', 'Villa'),
    building: await mk('BUILDING_TYPE', 'Independent'),
    locA: await mk('LOCATION', 'Anna Nagar', w.A),
    locB: await mk('LOCATION', 'Adyar', w.B),
    lost: await mk('LOST_REASON', 'Budget too low'),
  };
  defaultSource = m.source;
  return { ...w, salesA2, m };
}
export type EW = Awaited<ReturnType<typeof enquiryWorld>>;

/** Source is required, so helpers add the world's source unless a test sets `sourceId` itself (use `sourceId: undefined` to omit it). */
let defaultSource: string | undefined;
const withSource = (body: Record<string, unknown>) => ('sourceId' in body || !defaultSource ? body : { ...body, sourceId: defaultSource });
export const createEnquiryApi = (app: Express, who: Who, body: Record<string, unknown>) => request(app).post(api('/enquiries')).set(who.auth).send(withSource(body));

let n = 0;
export const person = (name = `Person ${++n}`, phone = freshPhone()) => ({ name, phone });

export async function mkEnquiry(app: Express, who: Who, extra: Record<string, unknown> = {}, p = person()) {
  const res = await createEnquiryApi(app, who, { person: p, ...extra });
  if (res.status !== 201) throw new Error(`createEnquiry failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; enquiryNo: string; personId: string; branchId: string; stageCode: string; name: string };
}

export const transition = (app: Express, who: Who, id: string, body: Record<string, unknown>) => request(app).post(api(`/enquiries/${id}/transition`)).set(who.auth).send(body);
export const assign = (app: Express, who: Who, id: string, body: Record<string, unknown>) => request(app).post(api(`/enquiries/${id}/assign`)).set(who.auth).send(body);

/** Moves an enquiry forward through consecutive MANUAL stages as a manager (test setup). */
export async function advance(app: Express, who: Who, id: string, ...stages: string[]) {
  for (const to of stages) {
    const res = await transition(app, who, id, { to });
    if (res.status !== 200) throw new Error(`advance to ${to} failed ${res.status} ${JSON.stringify(res.body)}`);
  }
}
export { actor, makeUser, PASSWORD, login, Types };

/** Follow-up helpers: a world plus one enquiry per person and the master values a follow-up needs. */
export async function followUpWorld(app: Express) {
  const w = await enquiryWorld(app);
  const admin = w.admin;
  const type = (await request(app).get(api('/masters?types=FOLLOWUP_TYPE'))
    .set(admin.auth)).body.data.FOLLOWUP_TYPE as { _id: string; code: string }[];
  const t = Object.fromEntries(type.map((x) => [x.code, x._id])) as Record<string, string>;
  return { ...w, ft: { call: t.CALL!, meeting: t.MEETING!, whatsapp: t.WHATSAPP! } };
}
export type FW = Awaited<ReturnType<typeof followUpWorld>>;

/** A time `minutes` from now (negative = past) as an ISO string. */
export const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
export const inDays = (days: number) => inMinutes(days * 24 * 60);

export const createFollowUpApi = (app: Express, who: Who, body: Record<string, unknown>) => request(app).post(api('/followups')).set(who.auth).send(body);
export async function mkFollowUp(app: Express, who: Who, body: Record<string, unknown>) {
  const res = await createFollowUpApi(app, who, body);
  if (res.status !== 201) throw new Error(`createFollowUp failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; statusKey: string; enquiryId?: string; clientId?: string; assignedTo: string; scheduledAt: string; allowed: Record<string, boolean> };
}
