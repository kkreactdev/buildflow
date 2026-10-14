import type { Express } from 'express';
import request from 'supertest';
import { actor, makeBranch } from './factories';
import { Role } from '../modules/roles/role.model';

export const api = (p: string) => `/api/v1${p}`;

/** Two branches, a manager and sales executive in A, a manager in B, and an ALL-scope admin. */
export async function peopleWorld(app: Express) {
  const A = (await makeBranch('A'))._id.toHexString();
  const B = (await makeBranch('B'))._id.toHexString();
  const admin = await actor(app, 'ADMIN');
  const mgrA = await actor(app, 'MANAGER', [A]);
  const salesA = await actor(app, 'SALES_EXECUTIVE', [A]);
  const mgrB = await actor(app, 'MANAGER', [B]);
  const salesB = await actor(app, 'SALES_EXECUTIVE', [B]);
  return { A, B, admin, mgrA, salesA, mgrB, salesB };
}

type Who = { auth: Record<string, string> };

export const lookup = (app: Express, who: Who, phone: string) => request(app).post(api('/persons/lookup')).set(who.auth).send({ phone });
export const createPersonApi = (app: Express, who: Who, body: Record<string, unknown>) => request(app).post(api('/persons')).set(who.auth).send(body);
export const createClientApi = (app: Express, who: Who, body: Record<string, unknown>) => request(app).post(api('/clients')).set(who.auth).send(body);

let n = 0;
/** A fresh valid Indian mobile number each call. */
export const freshPhone = (): string => `9${String(800000000 + ++n * 7919).padStart(9, '0')}`.slice(0, 10);

export async function grant(roleKey: string, ...perms: string[]) {
  await Role.updateOne({ key: roleKey }, { $addToSet: { permissions: { $each: perms } } });
}
export async function revoke(roleKey: string, ...perms: string[]) {
  await Role.updateOne({ key: roleKey }, { $pull: { permissions: { $in: perms } } });
}
