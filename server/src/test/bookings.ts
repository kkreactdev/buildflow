import type { Express } from 'express';
import request from 'supertest';
import { advance, api, grant, inDays, mkEnquiry, mkUnit, revoke } from './sitevisits';
import { completeVisitApi, mkVisit, readyEnquiry } from './sitevisits';
import { unitWorld, type UW } from './units';

export { api, grant, mkUnit, revoke, advance, mkEnquiry };

type Who = { auth: Record<string, string> };

export async function bookingWorld(app: Express) {
  return unitWorld(app);
}
export type BW = UW;

/** An enquiry that has been through a completed site visit and is now in NEGOTIATION: the stage just before BOOKED. */
export async function negotiationEnquiry(app: Express, w: UW, extra: Record<string, unknown> = {}) {
  const e = await readyEnquiry(app, w, extra);
  const visit = await mkVisit(app, w.mgrA, { enquiryId: e.id, assignedTo: w.mgrA.user._id.toHexString(), scheduledAt: inDays(1) });
  const done = await completeVisitApi(app, w.mgrA, visit.id);
  if (done.status !== 200) throw new Error(`complete visit failed ${done.status} ${JSON.stringify(done.body)}`);
  await advance(app, w.mgrA, e.id, 'NEGOTIATION');
  return e;
}

/** A booking date a minute ago, with an explicit zone as the API requires. */
export const justNow = () => new Date(Date.now() - 60_000).toISOString();

export const createBookingApi = (app: Express, who: Who, body: Record<string, unknown>) => request(app).post(api('/bookings')).set(who.auth).send({ bookingDate: justNow(), ...body });
export async function mkBooking(app: Express, who: Who, body: Record<string, unknown>) {
  const res = await createBookingApi(app, who, body);
  if (res.status !== 201) throw new Error(`createBooking failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; bookingNo: string; unitId: string; enquiryId: string; branchId: string; salespersonId: string; status: string };
}
export const releaseBookingApi = (app: Express, who: Who, id: string, body: Record<string, unknown> = { reason: 'Customer withdrew' }) => request(app).post(api(`/bookings/${id}/release`)).set(who.auth).send(body);
export const getBookingApi = (app: Express, who: Who, id: string) => request(app).get(api(`/bookings/${id}`)).set(who.auth);
export const resolveConflictApi = (app: Express, who: Who, id: string, body: Record<string, unknown>) => request(app).post(api(`/booking-conflicts/${id}/resolve`)).set(who.auth).send(body);
