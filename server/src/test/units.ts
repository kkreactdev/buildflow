import type { Express } from 'express';
import request from 'supertest';
import { api, enquiryWorld, grant, revoke } from './enquiries';

export { api, grant, revoke };

type Who = { auth: Record<string, string> };

/** A 1x1 PNG, a minimal JPEG header, WebP and PDF stubs: just enough bytes for format detection. */
export const FILES = {
  png: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHN6dBgAAAABJRU5ErkJggg==', 'base64'),
  jpg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]),
  webp: Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(16, 2)]),
  pdf: Buffer.from('%PDF-1.4\n%stub\n'),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  exe: Buffer.from('MZ\u0090\u0000\u0003'),
};

/** Enquiry world + one value of every master a unit stores (a location per branch, media types, unit statuses). */
export async function unitWorld(app: Express) {
  const w = await enquiryWorld(app);
  const masters = (await request(app).get(api('/masters?types=UNIT_STATUS,MEDIA_TYPE')).set(w.admin.auth)).body.data as Record<string, { _id: string; code: string }[]>;
  const by = (type: string) => Object.fromEntries(masters[type]!.map((x) => [x.code, x._id])) as Record<string, string>;
  const st = by('UNIT_STATUS');
  const mt = by('MEDIA_TYPE');
  const mk = async (type: string, label: string) => (await request(app).post(api(`/masters/${type}`)).set(w.admin.auth).send({ label })).body.data._id as string;
  const extraStatus = await mk('UNIT_STATUS', 'On hold');
  return { ...w, st: { available: st.AVAILABLE!, booked: st.BOOKED!, sold: st.SOLD!, hold: extraStatus }, mt: { front: mt.FRONT!, floor: mt.FLOOR_PLAN!, brochure: mt.BROCHURE! } };
}
export type UW = Awaited<ReturnType<typeof unitWorld>>;

export const full = (w: UW) => ({ propertyTypeId: w.m.property, buildingTypeId: w.m.building, locationId: w.m.locA });

export const createUnitApi = (app: Express, who: Who, body: Record<string, unknown>) => request(app).post(api('/units')).set(who.auth).send(body);
let n = 0;
export async function mkUnit(app: Express, who: Who, extra: Record<string, unknown> = {}) {
  const res = await createUnitApi(app, who, { name: `Unit ${++n}`, ...extra });
  if (res.status !== 201) throw new Error(`createUnit failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; unitCode: string; branchId: string; statusKey: string; assignedTo?: string; statusId: string };
}
export const assignUnit = (app: Express, who: Who, id: string, body: Record<string, unknown>) => request(app).post(api(`/units/${id}/assign`)).set(who.auth).send(body);
export const setStatus = (app: Express, who: Who, id: string, body: Record<string, unknown>) => request(app).post(api(`/units/${id}/status`)).set(who.auth).send(body);
export const uploadMedia = (app: Express, who: Who, id: string, file: Buffer | undefined, fields: Record<string, string>, filename = 'photo.bin') => {
  const req = request(app).post(api(`/units/${id}/media`)).set(who.auth);
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return file ? req.attach('file', file, filename) : req;
};
