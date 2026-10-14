import type { Express } from 'express';
import request from 'supertest';
import { api } from './units';

export { api };

type Who = { auth: Record<string, string> };

/** Distinct, valid PDFs so the duplicate guard does not treat different test files as the same one. */
export const pdf = (n: number | string) => Buffer.from(`%PDF-1.4\n%document ${n}\n%%EOF\n`);
export const png = (n: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`image ${n}`)]);

/** No document types are seeded (administrators define their own), so tests create the ones they need through the masters API. */
export async function documentTypes(app: Express, who: Who) {
  const out: Record<string, string> = {};
  for (const [code, label] of [['ID_PROOF', 'ID proof'], ['ADDRESS_PROOF', 'Address proof'], ['AGREEMENT', 'Agreement'], ['OTHER', 'Other']] as const) {
    const res = await request(app).post(api('/masters/DOCUMENT_TYPE')).set(who.auth).send({ label });
    if (res.status !== 201) throw new Error(`create document type failed ${res.status}`);
    out[code] = res.body.data._id as string;
  }
  return out;
}

export function uploadDocApi(app: Express, who: Who, target: { entityType: string; entityId: string }, file: Buffer | undefined, fields: Record<string, string>, filename = 'file.pdf', contentType?: string) {
  const req = request(app).post(api(`/documents?entityType=${target.entityType}&entityId=${target.entityId}`)).set(who.auth);
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return file ? req.attach('file', file, { filename, ...(contentType ? { contentType } : {}) }) : req;
}
export async function mkDoc(app: Express, who: Who, target: { entityType: string; entityId: string }, documentTypeId: string, n: number | string = Math.random(), extra: Record<string, string> = {}) {
  const res = await uploadDocApi(app, who, target, pdf(n), { documentTypeId, ...extra }, `doc-${n}.pdf`);
  if (res.status !== 201) throw new Error(`upload failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; documentNo: string; entityId: string; branchId: string };
}
export const replaceDocApi = (app: Express, who: Who, id: string, file: Buffer | undefined, filename = 'new.pdf') => {
  const req = request(app).post(api(`/documents/${id}/file`)).set(who.auth);
  return file ? req.attach('file', file, filename) : req;
};
export const getDocApi = (app: Express, who: Who, id: string) => request(app).get(api(`/documents/${id}`)).set(who.auth);
export const docUrlApi = (app: Express, who: Who, id: string, q = '') => request(app).get(api(`/documents/${id}/url${q}`)).set(who.auth);
