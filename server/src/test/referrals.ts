import type { Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { api, createClientApi, enquiryWorld, freshPhone, grant, mkEnquiry, revoke } from './enquiries';
import { Users } from './factories';

export { api, createClientApi, freshPhone, grant, mkEnquiry, revoke };

type Who = { auth: Record<string, string> };

export async function referralWorld(app: Express) {
  return enquiryWorld(app);
}
export type RW = Awaited<ReturnType<typeof referralWorld>>;

export const createReferralApi = (app: Express, who: Who, body: Record<string, unknown>) => request(app).post(api('/referrals')).set(who.auth).send(body);
export const fromClientApi = (app: Express, who: Who, clientId: string, body: Record<string, unknown> = {}) => request(app).post(api(`/referrals/from-client/${clientId}`)).set(who.auth).send(body);
export const fromUserApi = (app: Express, who: Who, userId: string, body: Record<string, unknown> = {}) => request(app).post(api(`/referrals/from-user/${userId}`)).set(who.auth).send(body);
export const getReferralApi = (app: Express, who: Who, id: string) => request(app).get(api(`/referrals/${id}`)).set(who.auth);
export const linkApi = (app: Express, who: Who, id: string, enquiryId: string) => request(app).post(api(`/referrals/${id}/enquiries`)).set(who.auth).send({ enquiryId });

type Created = { id: string; referralNo: string; personId: string; branchId: string; typeId: string; assignedTo?: string };
export async function mkExternal(app: Express, who: Who, name = 'Ravi Referrer', extra: Record<string, unknown> = {}) {
  const res = await createReferralApi(app, who, { person: { name, phone: freshPhone() }, ...extra });
  if (res.status !== 201) throw new Error(`createReferral failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as Created;
}
export async function mkClient(app: Express, who: Who, name = 'Client Person', extra: Record<string, unknown> = {}) {
  const res = await createClientApi(app, who, { person: { name, phone: freshPhone() }, ...extra });
  if (res.status !== 201) throw new Error(`createClient failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; clientNo: string; personId: string; branchId: string };
}
/** Employees get their phone through their profile; set it directly for tests. */
export async function setUserPhone(userId: Types.ObjectId | string, phone: string | undefined) {
  await Users.updateOne({ _id: userId }, phone === undefined ? { $unset: { phone: 1 } } : { $set: { phone } });
}
