import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { PERMISSION_CATALOG } from '../../core/permissions/catalog';
import { systemRepo } from '../../core/scope/system';
import { getMediaProvider, setMediaProvider } from '../../core/storage/mediaProvider';
import { MockMediaProvider } from '../../core/storage/mockProvider';
import { useTestDb } from '../../test/db';
import { Activities, AuditLogs, seedAll } from '../../test/factories';
import { api, docUrlApi, documentTypes, getDocApi, mkDoc, pdf, png, replaceDocApi, uploadDocApi } from '../../test/documents';
import { bookingWorld, grant, mkBooking, mkUnit, negotiationEnquiry, revoke } from '../../test/bookings';
import { createClientApi, freshPhone } from '../../test/enquiries';
import { mkExternal } from '../../test/referrals';
import { mkVisit, readyEnquiry } from '../../test/sitevisits';
import { FILES } from '../../test/units';
import { isMasterReferenced } from '../masters/references';
import { Master } from '../masters/master.model';
import { DocumentRecord } from './document.model';

const app = buildApp();
const Docs = systemRepo(DocumentRecord, 'test', 'fixtures');
const Masters = systemRepo(Master, 'test', 'fixtures');

useTestDb();
beforeEach(async () => {
  await seedAll();
  setMediaProvider(new MockMediaProvider());
});
const mock = () => getMediaProvider() as MockMediaProvider;
const uid = (a: { user: { _id: Types.ObjectId } }) => a.user._id.toHexString();
const nos = (res: request.Response) => (res.body.data as { documentNo: string }[]).map((d) => d.documentNo);
const list = (who: { auth: Record<string, string> }, q = '') => request(app).get(api(`/documents${q}`)).set(who.auth);

async function world() {
  const w = await bookingWorld(app);
  const types = await documentTypes(app, w.admin);
  const client = (await createClientApi(app, w.mgrA, { person: { name: 'Doc Client', phone: freshPhone() } })).body.data as { id: string; branchId: string };
  return { w, types, client, target: { entityType: 'client', entityId: client.id } };
}

describe('uploading', () => {
  it('stores the file privately, links it to the record in the record\'s branch, and never exposes a storage key or URL', async () => {
    const { w, types, client, target } = await world();
    const res = await uploadDocApi(app, w.mgrA, target, pdf(1), { documentTypeId: types.ID_PROOF!, notes: 'Aadhaar front' }, 'Aadhaar front.pdf', 'text/html'); // the browser's claim is ignored
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      documentNo: 'DOC-000001', entityType: 'client', entityId: client.id, branchId: w.A, branch: { code: 'A' }, type: { label: 'ID proof' }, name: 'Aadhaar front', notes: 'Aadhaar front',
      file: { originalName: 'Aadhaar front.pdf', mime: 'application/pdf', format: 'pdf', version: 1, uploadedByName: w.mgrA.user.name }, versionCount: 1, isArchived: false,
    });
    expect(res.body.data.entityNo).toMatch(/^CL-/);
    expect(JSON.stringify(res.body)).not.toMatch(/publicId|https?:\/\/|media\.test|sha|contentHash/i);
    const assets = [...mock().assets.values()];
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ access: 'private', url: '' }); // no plain URL exists for it
    expect(await AuditLogs.findOne({ entityType: 'document', action: 'upload' }).lean()).toBeTruthy();
    const act = await Activities.findOne({ type: 'DOCUMENT_UPLOADED' }).lean();
    expect(act!.refs.map((r) => r.type).sort()).toEqual(['client', 'document']);
    expect((await request(app).get(api(`/activities?refType=client&refId=${client.id}`)).set(w.mgrA.auth)).body.data.map((a: { type: string }) => a.type)).toContain('DOCUMENT_UPLOADED');
  });

  it('works for every supported record type, in that record\'s branch', async () => {
    const { w, types, client } = await world();
    const enquiry = await negotiationEnquiry(app, w);
    const unit = await mkUnit(app, w.mgrA);
    const visitEnquiry = await readyEnquiry(app, w);
    const visit = await mkVisit(app, w.mgrA, { enquiryId: visitEnquiry.id });
    const booking = await mkBooking(app, w.mgrA, { unitId: (await mkUnit(app, w.mgrA)).id, enquiryId: enquiry.id });
    const referral = await mkExternal(app, w.mgrA);
    const sold = (await request(app).post(api('/sellers')).set(w.mgrA.auth).send({ person: { name: 'Doc Seller', phone: freshPhone() }, property: { name: 'Doc Plot' } })).body.data;
    const targets = [['client', client.id], ['enquiry', enquiry.id], ['unit', unit.id], ['sitevisit', visit.id], ['booking', booking.id], ['referral', referral.id], ['seller', sold.seller.id], ['sellerProperty', sold.property.id]] as const;
    for (const [i, [entityType, entityId]] of targets.entries()) {
      const d = await mkDoc(app, w.mgrA, { entityType, entityId }, types.AGREEMENT!, `t${i}`);
      expect(d.branchId, entityType).toBe(w.A);
      const byRecord = await list(w.mgrA, `?entityType=${entityType}&entityId=${entityId}`);
      expect(nos(byRecord), entityType).toEqual([d.documentNo]);
    }
    expect((await request(app).get(api('/documents/entity-types')).set(w.mgrA.auth)).body.data.map((t: { type: string }) => t.type)).toEqual(['client', 'enquiry', 'unit', 'sitevisit', 'booking', 'referral', 'seller', 'sellerProperty']);
  });

  it('judges the file by its CONTENT: images and PDFs pass whatever the browser says; SVG, programs and text are refused and nothing is stored', async () => {
    const { w, types, target } = await world();
    for (const [file, name] of [[png(1), 'scan.png'], [FILES.jpg, 'photo.jpeg'], [FILES.webp, 'img.webp']] as const) {
      expect((await uploadDocApi(app, w.mgrA, target, file, { documentTypeId: types.OTHER! }, name, 'application/octet-stream')).status, name).toBe(201);
    }
    const before = mock().assets.size;
    for (const [file, name] of [[FILES.svg, 'x.svg'], [FILES.exe, 'x.exe'], [Buffer.from('plain text'), 'x.txt'], [FILES.svg, 'x.pdf'], [Buffer.from('<html></html>'), 'x.pdf']] as const) {
      const res = await uploadDocApi(app, w.mgrA, target, file, { documentTypeId: types.OTHER! }, name, 'application/pdf'); // claiming PDF does not help
      expect(res.status, name).toBe(415);
      expect(res.body.error.code, name).toBe('UNSUPPORTED_FILE_TYPE');
    }
    expect(mock().assets.size).toBe(before);
    expect(await Docs.countDocuments({})).toBe(3);
  });

  it('the file name must agree with the content, and is reduced to a plain name', async () => {
    const { w, types, target } = await world();
    const mismatch = await uploadDocApi(app, w.mgrA, target, png(2), { documentTypeId: types.OTHER! }, 'scan.pdf');
    expect(mismatch.body.error.code).toBe('FILE_EXTENSION_MISMATCH');
    expect((await uploadDocApi(app, w.mgrA, target, pdf(3), { documentTypeId: types.OTHER! }, 'noextension')).status).toBe(415);
    const sneaky = await uploadDocApi(app, w.mgrA, target, pdf(4), { documentTypeId: types.OTHER! }, '..\\..\\etc/passwd.pdf');
    expect(sneaky.status).toBe(201);
    expect(sneaky.body.data.file.originalName).toBe('passwd.pdf');
    expect(mock().assets.size).toBe(1);
  });

  it('enforces the size limit before anything is stored, and needs a file', async () => {
    const { w, types, target } = await world();
    const big = Buffer.concat([pdf('big'), Buffer.alloc(1024 * 1024 + 10)]); // test limit is 1 MB
    const res = await uploadDocApi(app, w.mgrA, target, big, { documentTypeId: types.OTHER! });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect((await uploadDocApi(app, w.mgrA, target, undefined, { documentTypeId: types.OTHER! })).status).toBe(400);
    expect((await uploadDocApi(app, w.mgrA, target, Buffer.alloc(0), { documentTypeId: types.OTHER! }, 'e.pdf')).status).toBe(400);
    expect(mock().assets.size).toBe(0);
    expect(await Docs.countDocuments({})).toBe(0);
  });

  it('the document type is a master: required, existing, of the right type and ACTIVE; an inactive one still displays on old documents', async () => {
    const { w, types, target } = await world();
    const up = (documentTypeId?: string) => uploadDocApi(app, w.mgrA, target, pdf(`t${documentTypeId}`), documentTypeId ? { documentTypeId } : {});
    for (const bad of [undefined, 'nope', new Types.ObjectId().toHexString(), w.m.source]) expect((await up(bad)).status, String(bad)).toBe(400);
    const d = await mkDoc(app, w.mgrA, target, types.ADDRESS_PROOF!, 'a');
    await request(app).patch(api(`/masters/DOCUMENT_TYPE/${types.ADDRESS_PROOF}`)).set(w.admin.auth).send({ isActive: false });
    expect((await up(types.ADDRESS_PROOF)).status).toBe(400); // cannot choose a retired type
    expect((await getDocApi(app, w.mgrA, d.id)).body.data.type).toMatchObject({ label: 'Address proof', isActive: false });
    expect(nos(await list(w.mgrA)).length).toBe(1);
    expect((await list(w.mgrA)).body.data[0].type.isActive).toBe(false);
    expect((await request(app).patch(api(`/documents/${d.id}`)).set(w.mgrA.auth).send({ name: 'Renamed' })).status).toBe(200); // still editable
    expect((await request(app).patch(api(`/documents/${d.id}`)).set(w.mgrA.auth).send({ documentTypeId: types.ADDRESS_PROOF })).status).toBe(200); // unchanged retired value is fine
  });

  it('with no document types configured at all, uploading is refused clearly', async () => {
    const { w, target } = await world();
    await Masters.deleteMany({ type: 'DOCUMENT_TYPE' });
    const res = await uploadDocApi(app, w.mgrA, target, pdf('x'), { documentTypeId: new Types.ObjectId().toHexString() });
    expect(res.status).toBe(400);
    expect(mock().assets.size).toBe(0);
  });

  it('rejects unknown fields and bad targets', async () => {
    const { w, types, client } = await world();
    const good = { documentTypeId: types.OTHER! };
    expect((await uploadDocApi(app, w.mgrA, { entityType: 'client', entityId: client.id }, pdf('a'), { ...good, branchId: w.B })).status).toBe(400); // branch is never taken from the request
    expect((await uploadDocApi(app, w.mgrA, { entityType: 'client', entityId: client.id }, pdf('b'), { ...good, documentNo: 'DOC-9' })).status).toBe(400);
    expect((await uploadDocApi(app, w.mgrA, { entityType: 'person', entityId: client.id }, pdf('c'), good)).status).toBe(400); // not a supported record type
    expect((await uploadDocApi(app, w.mgrA, { entityType: 'client', entityId: 'nope' }, pdf('d'), good)).status).toBe(400);
    expect(await Docs.countDocuments({})).toBe(0);
  });
});

describe('the record must exist, be visible and be open', () => {
  it('unknown, foreign-branch and archived records are refused; nothing is uploaded', async () => {
    const { w, types, client } = await world();
    const foreign = (await createClientApi(app, w.mgrB, { person: { name: 'B Client', phone: freshPhone() } })).body.data;
    const up = (entityId: string) => uploadDocApi(app, w.mgrA, { entityType: 'client', entityId }, pdf(entityId), { documentTypeId: types.OTHER! });
    const missing = await up(new Types.ObjectId().toHexString());
    const crossed = await up(foreign.id);
    expect([missing.status, crossed.status]).toEqual([404, 404]);
    expect(missing.body.error.code).toBe(crossed.body.error.code);
    await request(app).delete(api(`/clients/${client.id}`)).set(w.mgrA.auth);
    const archived = await up(client.id);
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe('ENTITY_ARCHIVED');
    expect(mock().assets.size).toBe(0);
  });

  it('the record is checked BEFORE the file is read: an unauthorized caller uploads nothing even with a huge file', async () => {
    const { w, types, client } = await world();
    const foreign = (await createClientApi(app, w.mgrB, { person: { name: 'B Client', phone: freshPhone() } })).body.data;
    const big = Buffer.concat([pdf('big'), Buffer.alloc(2 * 1024 * 1024)]);
    const res = await uploadDocApi(app, w.mgrA, { entityType: 'client', entityId: foreign.id }, big, { documentTypeId: types.OTHER! });
    expect(res.status).toBe(404); // not 413: the body was never read
    void client;
  });
});

describe('permissions', () => {
  it('every route is guarded by its own permission', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'p');
    const none = { Authorization: 'Bearer nope' };
    for (const [m, p] of [['get', '/documents'], ['post', `/documents?entityType=client&entityId=${target.entityId}`], ['get', `/documents/${d.id}`], ['get', `/documents/${d.id}/url`], ['patch', `/documents/${d.id}`], ['post', `/documents/${d.id}/file`], ['delete', `/documents/${d.id}`]] as const) {
      expect((await request(app)[m](api(p)).set(none)).status, `${m} ${p}`).toBe(401);
    }
    await revoke('MANAGER', 'documents.view');
    expect((await list(w.mgrA)).status).toBe(403);
    expect((await docUrlApi(app, w.mgrA, d.id)).status).toBe(403);
    await grant('MANAGER', 'documents.view');
    await revoke('MANAGER', 'documents.upload');
    expect((await uploadDocApi(app, w.mgrA, target, pdf('q'), { documentTypeId: types.OTHER! })).status).toBe(403);
    expect((await replaceDocApi(app, w.mgrA, d.id, pdf('r'))).status).toBe(403);
    await revoke('MANAGER', 'documents.edit');
    expect((await request(app).patch(api(`/documents/${d.id}`)).set(w.mgrA.auth).send({ name: 'x' })).status).toBe(403);
    await revoke('MANAGER', 'documents.archive');
    expect((await request(app).delete(api(`/documents/${d.id}`)).set(w.mgrA.auth)).status).toBe(403);
    expect(PERMISSION_CATALOG.documents).toEqual(['view', 'upload', 'edit', 'archive']);
    expect((await Docs.findOne({ _id: d.id }).lean())!.isArchived).toBe(false);
  });
});

describe('scope: documents follow the record they hang off', () => {
  it('BRANCH sees its branch, ALL sees everything, a foreign branch filter is refused', async () => {
    const { w, types, target } = await world();
    const foreign = (await createClientApi(app, w.mgrB, { person: { name: 'B Client', phone: freshPhone() } })).body.data;
    const a = await mkDoc(app, w.mgrA, target, types.OTHER!, 'a');
    const b = await mkDoc(app, w.mgrB, { entityType: 'client', entityId: foreign.id }, types.OTHER!, 'b');
    expect(nos(await list(w.mgrA))).toEqual([a.documentNo]);
    expect(nos(await list(w.mgrB))).toEqual([b.documentNo]);
    expect(nos(await list(w.admin)).sort()).toEqual([a.documentNo, b.documentNo]);
    expect(nos(await list(w.admin, `?branchId=${w.B}`))).toEqual([b.documentNo]);
    const widen = await list(w.mgrA, `?branchId=${w.B}`);
    expect(widen.status).toBe(403);
    expect(widen.body.data).toBeUndefined();
  });

  it('cross-branch retrieval, link, edit, replacement and deletion are all the same 404 as a missing id', async () => {
    const { w, types } = await world();
    const foreign = (await createClientApi(app, w.mgrB, { person: { name: 'B Client', phone: freshPhone() } })).body.data;
    const b = await mkDoc(app, w.mgrB, { entityType: 'client', entityId: foreign.id }, types.OTHER!, 'b');
    const ghost = new Types.ObjectId().toHexString();
    const probes = (id: string) => [
      getDocApi(app, w.mgrA, id), docUrlApi(app, w.mgrA, id), request(app).patch(api(`/documents/${id}`)).set(w.mgrA.auth).send({ name: 'hijack' }),
      replaceDocApi(app, w.mgrA, id, pdf('evil')), request(app).delete(api(`/documents/${id}`)).set(w.mgrA.auth),
      list(w.mgrA, `?entityType=client&entityId=${foreign.id}`), request(app).get(api(`/activities?refType=document&refId=${id}`)).set(w.mgrA.auth),
    ];
    const real = await Promise.all(probes(b.id));
    const fake = await Promise.all(probes(ghost));
    expect(real.map((r) => r.status)).toEqual(Array(7).fill(404));
    expect(real.map((r) => r.body.error.code)).toEqual(fake.map((r) => r.body.error.code));
    expect((await Docs.findOne({ _id: b.id }).lean())).toMatchObject({ isArchived: false, name: 'doc-b' });
    expect(mock().assets.size).toBe(1); // the hijack replacement uploaded nothing
  });

  it('OWN: an executive reaches documents only through records they can see', async () => {
    const { w, types } = await world();
    const mine = (await createClientApi(app, w.mgrA, { person: { name: 'Mine', phone: freshPhone() }, assignedTo: uid(w.salesA) })).body.data;
    const others = (await createClientApi(app, w.mgrA, { person: { name: 'Others', phone: freshPhone() } })).body.data;
    const byManager = await mkDoc(app, w.mgrA, { entityType: 'client', entityId: mine.id }, types.OTHER!, 'm1'); // uploaded by the manager, on the executive's client
    const hidden = await mkDoc(app, w.mgrA, { entityType: 'client', entityId: others.id }, types.OTHER!, 'o1');
    expect(nos(await list(w.salesA, `?entityType=client&entityId=${mine.id}`))).toEqual([byManager.documentNo]); // sees the record's documents
    expect((await getDocApi(app, w.salesA, byManager.id)).status).toBe(200);
    expect((await docUrlApi(app, w.salesA, byManager.id)).status).toBe(200);
    expect((await list(w.salesA, `?entityType=client&entityId=${others.id}`)).status).toBe(404);
    expect((await getDocApi(app, w.salesA, hidden.id)).status).toBe(404);
    expect((await docUrlApi(app, w.salesA, hidden.id)).status).toBe(404);
    expect((await uploadDocApi(app, w.salesA, { entityType: 'client', entityId: others.id }, pdf('x'), { documentTypeId: types.OTHER! })).status).toBe(404);
    const own = await mkDoc(app, w.salesA, { entityType: 'client', entityId: mine.id }, types.OTHER!, 's1');
    // without a record, an OWN user browses only what they uploaded themselves
    expect(nos(await list(w.salesA))).toEqual([own.documentNo]);
    expect(nos(await list(w.mgrA)).length).toBe(3);
    // and they lose access when the record is no longer theirs
    await request(app).patch(api(`/clients/${mine.id}`)).set(w.mgrA.auth).send({ assignedTo: uid(w.salesA2) });
    expect((await getDocApi(app, w.salesA, own.id)).status).toBe(404);
    expect((await docUrlApi(app, w.salesA, own.id)).status).toBe(404);
  });
});

describe('retrieving a file', () => {
  it('returns a short-lived signed link only after the checks; the link is never stored or listed; each issue is audited', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'u');
    const res = await docUrlApi(app, w.mgrA, d.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileName: 'doc-u.pdf', mime: 'application/pdf', version: 1 });
    expect(res.body.data.url).toMatch(/^https:\/\/media\.test\/signed\/.+\.pdf\?exp=\d+&sig=/);
    const exp = Number(/exp=(\d+)/.exec(res.body.data.url)![1]);
    expect(exp).toBeGreaterThan(Date.now() / 1000);
    expect(exp).toBeLessThanOrEqual(Date.now() / 1000 + 301);
    expect(JSON.stringify((await getDocApi(app, w.mgrA, d.id)).body)).not.toMatch(/signed|https?:/);
    expect(JSON.stringify((await list(w.mgrA)).body)).not.toMatch(/signed|https?:/);
    expect(JSON.stringify(await Docs.findOne({ _id: d.id }).lean())).not.toMatch(/signed|https?:/);
    expect(await AuditLogs.countDocuments({ entityType: 'document', action: 'download' })).toBe(1);
    expect((await docUrlApi(app, w.mgrA, d.id, '?version=0')).status).toBe(400);
    expect((await docUrlApi(app, w.mgrA, d.id, '?version=7')).status).toBe(404);
  });
});

describe('failures leave nothing behind', () => {
  it('a failed upload to storage creates no record', async () => {
    const { w, types, target } = await world();
    mock().failNextUpload = true;
    const res = await uploadDocApi(app, w.mgrA, target, pdf('f'), { documentTypeId: types.OTHER! });
    expect(res.status).toBe(500);
    expect(await Docs.countDocuments({})).toBe(0);
    expect(mock().assets.size).toBe(0);
    expect(await AuditLogs.countDocuments({ entityType: 'document' })).toBe(0);
  });

  it('a failed database write after the upload removes the stored file and writes no audit or timeline entry', async () => {
    const { w, types, target } = await world();
    // Poison the next number so the insert fails after the file was stored.
    await Docs.create({ documentNo: 'DOC-000001', branchId: new Types.ObjectId(w.A), entityType: 'client', entityId: new Types.ObjectId(), entityNo: 'CL-X', documentTypeId: new Types.ObjectId(types.OTHER), name: 'poison', contentHash: 'x', fileVersion: 1, file: { version: 1, publicId: 'p', format: 'pdf', mime: 'application/pdf', bytes: 1, originalName: 'p.pdf', uploadedAt: new Date() } });
    const res = await uploadDocApi(app, w.mgrA, target, pdf('g'), { documentTypeId: types.OTHER! });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(mock().assets.size).toBe(0);
    expect(await Docs.countDocuments({})).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'document' })).toBe(0);
    expect(await Activities.countDocuments({ type: 'DOCUMENT_UPLOADED' })).toBe(0);
    expect((await uploadDocApi(app, w.mgrA, target, pdf('g'), { documentTypeId: types.OTHER! })).status).toBe(201); // the next number is free
  });

  it('a failed clean-up never fails the caller', async () => {
    const { w, types, target } = await world();
    await Docs.create({ documentNo: 'DOC-000001', branchId: new Types.ObjectId(w.A), entityType: 'client', entityId: new Types.ObjectId(), entityNo: 'CL-X', documentTypeId: new Types.ObjectId(types.OTHER), name: 'poison', contentHash: 'x', fileVersion: 1, file: { version: 1, publicId: 'p', format: 'pdf', mime: 'application/pdf', bytes: 1, originalName: 'p.pdf', uploadedAt: new Date() } });
    mock().failDestroy = true;
    expect((await uploadDocApi(app, w.mgrA, target, pdf('h'), { documentTypeId: types.OTHER! })).status).toBe(409); // the real error, not the clean-up one
  });
});

describe('duplicates and concurrency', () => {
  it('the same file cannot be attached twice to one record (even at once); another record or an archived copy does not block', async () => {
    const { w, types, client, target } = await world();
    const first = await mkDoc(app, w.mgrA, target, types.OTHER!, 'same');
    const again = await uploadDocApi(app, w.mgrA, target, pdf('same'), { documentTypeId: types.OTHER! }, 'copy.pdf');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'DUPLICATE_DOCUMENT', details: { documentNo: first.documentNo } });
    expect(mock().assets.size).toBe(1);
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => uploadDocApi(app, i % 2 ? w.mgrA : w.admin, target, pdf('race'), { documentTypeId: types.OTHER! }, `race${i}.pdf`)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(Array(5).fill('DUPLICATE_DOCUMENT'));
    expect(await Docs.countDocuments({ entityId: client.id })).toBe(2);
    expect(mock().assets.size).toBe(2); // the losers' files were removed
    const other = (await createClientApi(app, w.mgrA, { person: { name: 'Other', phone: freshPhone() } })).body.data;
    expect((await uploadDocApi(app, w.mgrA, { entityType: 'client', entityId: other.id }, pdf('same'), { documentTypeId: types.OTHER! })).status).toBe(201);
    await request(app).delete(api(`/documents/${first.id}`)).set(w.mgrA.auth);
    expect((await uploadDocApi(app, w.mgrA, target, pdf('same'), { documentTypeId: types.OTHER! }, 'again.pdf')).status).toBe(201);
  }, 60_000);

  it('document numbers are unique under concurrency, and the database enforces the one-copy rule', async () => {
    const { w, types, client } = await world();
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => uploadDocApi(app, w.mgrA, { entityType: 'client', entityId: client.id }, pdf(`n${i}`), { documentTypeId: types.OTHER! }, `n${i}.pdf`)));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(new Set(rs.map((r) => r.body.data.documentNo)).size).toBe(10);
    await DocumentRecord.init();
    const idx = (await DocumentRecord.collection.indexes()).find((i) => i.name === 'one_active_copy_of_a_file_per_record');
    expect(idx).toMatchObject({ unique: true, partialFilterExpression: { isArchived: false } });
  }, 60_000);
});

describe('replacing the file', () => {
  it('keeps the old file as a retrievable version, and records who replaced it', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'v1');
    const res = await replaceDocApi(app, w.mgrA, d.id, pdf('v2'), 'revised.pdf');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ versionCount: 2, file: { version: 2, originalName: 'revised.pdf' }, previousFiles: [{ version: 1, originalName: 'doc-v1.pdf' }] });
    expect(JSON.stringify(res.body)).not.toMatch(/publicId/);
    expect(mock().assets.size).toBe(2); // the old file is kept
    expect((await docUrlApi(app, w.mgrA, d.id)).body.data.fileName).toBe('revised.pdf');
    expect((await docUrlApi(app, w.mgrA, d.id, '?version=1')).body.data.fileName).toBe('doc-v1.pdf');
    expect(await AuditLogs.findOne({ entityType: 'document', action: 'replace' }).lean()).toBeTruthy();
    expect(await Activities.countDocuments({ type: 'DOCUMENT_REPLACED' })).toBe(1);
  });

  it('is validated like an upload; the same content is refused', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'v1');
    expect((await replaceDocApi(app, w.mgrA, d.id, pdf('v1'))).body.error.code).toBe('SAME_FILE');
    expect((await replaceDocApi(app, w.mgrA, d.id, FILES.svg, 'x.svg')).status).toBe(415);
    expect((await replaceDocApi(app, w.mgrA, d.id, png(1), 'x.pdf')).body.error.code).toBe('FILE_EXTENSION_MISMATCH');
    expect((await replaceDocApi(app, w.mgrA, d.id, undefined)).status).toBe(400);
    expect((await replaceDocApi(app, w.mgrA, d.id, Buffer.concat([pdf('big'), Buffer.alloc(1024 * 1024 + 10)]))).status).toBe(413);
    expect(mock().assets.size).toBe(1);
    expect((await Docs.findOne({ _id: d.id }).lean())!.fileVersion).toBe(1);
  });

  it('simultaneous replacements: exactly one wins and the loser\'s uploaded file is removed', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'v1');
    const rs = await Promise.all([replaceDocApi(app, w.mgrA, d.id, pdf('a2'), 'a.pdf'), replaceDocApi(app, w.admin, d.id, pdf('b2'), 'b.pdf'), replaceDocApi(app, w.mgrA, d.id, pdf('c2'), 'c.pdf')]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(['DOCUMENT_CHANGED', 'DOCUMENT_CHANGED']);
    expect((await Docs.findOne({ _id: d.id }).lean())).toMatchObject({ fileVersion: 2 });
    expect(mock().assets.size).toBe(2); // original + the winner only
  }, 60_000);

  it('an archived document cannot be replaced', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'v1');
    await request(app).delete(api(`/documents/${d.id}`)).set(w.mgrA.auth);
    expect((await replaceDocApi(app, w.mgrA, d.id, pdf('v2'))).status).toBe(404);
  });
});

describe('updating and archiving', () => {
  it('edits title, type and notes with audit before/after; the file and its record cannot be changed this way', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'e');
    const res = await request(app).patch(api(`/documents/${d.id}`)).set(w.mgrA.auth).send({ name: 'Signed agreement', documentTypeId: types.AGREEMENT, notes: 'Page 1-4' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Signed agreement', type: { label: 'Agreement' }, notes: 'Page 1-4' });
    expect(await AuditLogs.findOne({ entityType: 'document', action: 'update' }).lean()).toMatchObject({ changes: { name: { from: 'doc-e', to: 'Signed agreement' } } });
    expect(await Activities.countDocuments({ type: 'DOCUMENT_UPDATED' })).toBe(1);
    expect((await request(app).patch(api(`/documents/${d.id}`)).set(w.mgrA.auth).send({ notes: null })).body.data.notes).toBeUndefined();
    for (const bad of [{}, { entityId: w.A }, { entityType: 'unit' }, { branchId: w.B }, { file: {} }, { documentNo: 'DOC-9' }, { name: '' }, { documentTypeId: w.m.source }]) {
      expect((await request(app).patch(api(`/documents/${d.id}`)).set(w.mgrA.auth).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('archiving hides it from normal lists but keeps the record, its files and history for authorized views', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'z');
    await replaceDocApi(app, w.mgrA, d.id, pdf('z2'));
    expect((await request(app).delete(api(`/documents/${d.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect((await list(w.mgrA)).body.meta.total).toBe(0);
    expect(nos(await list(w.mgrA, '?isArchived=true'))).toEqual([d.documentNo]);
    const detail = (await getDocApi(app, w.mgrA, d.id)).body.data;
    expect(detail).toMatchObject({ isArchived: true, versionCount: 2 });
    expect(detail.allowed).toMatchObject({ download: true, edit: false, replace: false, archive: false });
    expect((await docUrlApi(app, w.mgrA, d.id, '?version=1')).status).toBe(200); // history stays retrievable
    expect(mock().assets.size).toBe(2); // nothing was destroyed
    expect((await request(app).delete(api(`/documents/${d.id}`)).set(w.mgrA.auth)).status).toBe(404);
    expect((await request(app).patch(api(`/documents/${d.id}`)).set(w.mgrA.auth).send({ name: 'x' })).status).toBe(404);
    expect(await AuditLogs.countDocuments({ entityType: 'document', action: 'archive' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'DOCUMENT_ARCHIVED' })).toBe(1);
    expect((await request(app).get(api(`/activities?refType=document&refId=${d.id}`)).set(w.mgrA.auth)).body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('documents of an archived record stay readable', async () => {
    const { w, types, client, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 'k');
    await request(app).delete(api(`/clients/${client.id}`)).set(w.mgrA.auth);
    expect((await getDocApi(app, w.mgrA, d.id)).status).toBe(200);
    expect(nos(await list(w.mgrA, `?entityType=client&entityId=${client.id}`))).toEqual([d.documentNo]);
    expect((await request(app).patch(api(`/documents/${d.id}`)).set(w.mgrA.auth).send({ name: 'still editable' })).status).toBe(200);
  });
});

describe('document types as masters', () => {
  it('a type used by a document cannot be deleted; an unused one can', async () => {
    const { w, types, target } = await world();
    const custom = (await request(app).post(api('/masters/DOCUMENT_TYPE')).set(w.admin.auth).send({ label: 'Sale deed' })).body.data._id as string;
    const unused = (await request(app).post(api('/masters/DOCUMENT_TYPE')).set(w.admin.auth).send({ label: 'Spare' })).body.data._id as string;
    await mkDoc(app, w.mgrA, target, custom, 'c');
    expect(await isMasterReferenced('DOCUMENT_TYPE', new Types.ObjectId(custom))).toBe(true);
    expect((await request(app).delete(api(`/masters/DOCUMENT_TYPE/${custom}`)).set(w.admin.auth)).body.error.code).toBe('IN_USE');
    expect((await request(app).delete(api(`/masters/DOCUMENT_TYPE/${unused}`)).set(w.admin.auth)).status).toBe(204);
    void types;
  });
});

describe('listing, search and filters (server-side)', () => {
  it('searches by number, title, file name and record number; filters by type, record and dates; sorts and paginates', async () => {
    const { w, types, client, target } = await world();
    const a = await mkDoc(app, w.mgrA, target, types.ID_PROOF!, 'alpha', { name: 'Aadhaar copy' });
    const b = await mkDoc(app, w.mgrA, target, types.AGREEMENT!, 'beta');
    expect(nos(await list(w.mgrA, `?search=${a.documentNo}`))).toEqual([a.documentNo]);
    expect(nos(await list(w.mgrA, '?search=2'))).toEqual([b.documentNo]);
    expect(nos(await list(w.mgrA, '?search=aadhaar'))).toEqual([a.documentNo]);
    expect(nos(await list(w.mgrA, '?search=doc-beta'))).toEqual([b.documentNo]);
    const entityNo = (await getDocApi(app, w.mgrA, a.id)).body.data.entityNo as string;
    expect(nos(await list(w.mgrA, `?search=${entityNo}&sort=documentNo`))).toEqual([a.documentNo, b.documentNo]);
    expect(nos(await list(w.mgrA, '?search=%5E.*'))).toEqual([]);
    expect(nos(await list(w.mgrA, `?documentTypeId=${types.AGREEMENT}`))).toEqual([b.documentNo]);
    expect(nos(await list(w.mgrA, `?entityType=client&entityId=${client.id}&sort=-documentNo`))).toEqual([b.documentNo, a.documentNo]);
    expect(nos(await list(w.mgrA, `?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`))).toEqual([]);
    const p = await list(w.mgrA, '?sort=documentNo&limit=1&page=2');
    expect(nos(p)).toEqual([b.documentNo]);
    expect(p.body.meta).toMatchObject({ page: 2, limit: 1, total: 2 });
    expect(nos(await list(w.mgrA, '?entityType=client')).length).toBe(2); // a record type alone narrows the scoped list
    expect(nos(await list(w.mgrA, '?entityType=unit'))).toEqual([]);
    for (const bad of ['?limit=1000', `?entityId=${client.id}`, '?entityType=person&entityId=' + client.id, '?documentTypeId=nope', '?from=garbage']) expect((await list(w.mgrA, bad)).status, bad).toBe(400);
  });
});

describe('timeline and audit access', () => {
  it('the document timeline is authorised through the record; audit needs audit.view', async () => {
    const { w, types, target } = await world();
    const d = await mkDoc(app, w.mgrA, target, types.OTHER!, 't');
    const tl = (who: { auth: Record<string, string> }) => request(app).get(api(`/activities?refType=document&refId=${d.id}`)).set(who.auth);
    expect((await tl(w.mgrA)).status).toBe(200);
    expect((await tl(w.admin)).status).toBe(200);
    expect((await tl(w.mgrB)).status).toBe(404);
    expect((await tl(w.salesA)).status).toBe(404); // OWN: the client is not theirs
    const audit = await request(app).get(api(`/audit?entityType=document&entityId=${d.id}`)).set(w.admin.auth);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toContain('upload');
    expect((await request(app).get(api(`/audit?entityType=document&entityId=${d.id}`)).set(w.mgrA.auth)).status).toBe(403);
  });
});

