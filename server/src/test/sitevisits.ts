import type { Express } from 'express';
import request from 'supertest';
import { advance, inDays, mkEnquiry } from './enquiries';
import { api, assignUnit, grant, mkUnit, revoke, unitWorld, type UW } from './units';

export { advance, api, assignUnit, grant, inDays, mkEnquiry, mkUnit, revoke };

type Who = { auth: Record<string, string> };

/** The unit world plus helpers for visits. Enquiries must reach INTERESTED before a visit can be scheduled. */
export async function visitWorld(app: Express) {
  const w = await unitWorld(app);
  return w;
}
export type VW = UW;

/** An enquiry in branch A (owned by `owner` when given) already moved to the stage that precedes "site visit scheduled". */
export async function readyEnquiry(app: Express, w: UW, extra: Record<string, unknown> = {}, who: Who = w.mgrA) {
  const e = await mkEnquiry(app, who, extra);
  await advance(app, w.mgrA, e.id, 'CONTACTED', 'INTERESTED');
  return e;
}

export const createVisitApi = (app: Express, who: Who, body: Record<string, unknown>) => request(app).post(api('/sitevisits')).set(who.auth).send(body);
export async function mkVisit(app: Express, who: Who, body: Record<string, unknown>) {
  const res = await createVisitApi(app, who, { scheduledAt: inDays(1), ...body });
  if (res.status !== 201) throw new Error(`createVisit failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; visitNo: string; branchId: string; enquiryId: string; statusKey: string; assignedTo: string; scheduledAt: string; units: { id: string; unitCode: string }[] };
}
export const completeVisitApi = (app: Express, who: Who, id: string, body: Record<string, unknown> = { feedback: 'Liked the villa' }) => request(app).post(api(`/sitevisits/${id}/complete`)).set(who.auth).send(body);
export const cancelVisitApi = (app: Express, who: Who, id: string, body: Record<string, unknown> = { reason: 'Customer unavailable' }) => request(app).post(api(`/sitevisits/${id}/cancel`)).set(who.auth).send(body);
export const assignVisitApi = (app: Express, who: Who, id: string, body: Record<string, unknown>) => request(app).post(api(`/sitevisits/${id}/assign`)).set(who.auth).send(body);
export const getVisitApi = (app: Express, who: Who, id: string) => request(app).get(api(`/sitevisits/${id}`)).set(who.auth);
