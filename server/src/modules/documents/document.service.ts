import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import type { z } from 'zod';
import { getEnv } from '../../config/env';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { formatSequence, nextSequence } from '../../core/counters/counter.service';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { extensionMatches, detectFormat, mimeFor, type MediaFormat } from '../../core/storage/fileTypes';
import { destroyQuietly, getMediaProvider } from '../../core/storage/mediaProvider';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { logger } from '../../lib/logger';
import { withTransaction } from '../../lib/transaction';
import { Branch } from '../branches/branch.model';
import { assertActiveMaster, masterLabels } from '../masters/master.service';
import { User } from '../users/user.model';
import { DOCUMENT_ENTITIES, DOCUMENT_ENTITY_TYPES, resolveEntity, type DocumentEntityType, type ResolvedEntity } from './document.entities';
import { DocumentRecord } from './document.model';
import './document.references';
import type { listDocumentQuery, updateDocumentBody } from './document.schema';

const DOC_NO = { prefix: 'DOC-', width: 6 } as const;
export const nextDocumentNo = async (): Promise<string> => formatSequence(await nextSequence('document'), DOC_NO);

type Id = Types.ObjectId;
interface FileLean { version: number; publicId: string; format: MediaFormat; mime: string; bytes: number; originalName: string; uploadedBy?: Id; uploadedAt: Date }
export type DocumentLean = {
  _id: Id; documentNo: string; branchId: Id; entityType: DocumentEntityType; entityId: Id; entityNo: string; documentTypeId: Id; name: string; notes?: string | null;
  file: FileLean; fileVersion: number; contentHash: string; previousFiles?: { file: FileLean; replacedAt: Date; replacedBy?: Id }[];
  isArchived?: boolean; createdAt?: Date; updatedAt?: Date; createdBy?: Id;
};

const repo = (p: Principal, requestedBranchId?: string, includeArchived = false) => scopedRepo(DocumentRecord, p, { requestedBranchId, includeArchived });
const log = (o: object, m: string) => logger.error(o, m);

// ---- access ---------------------------------------------------------------------------------

/**
 * THE access rule. A document can be used only if the caller may see the record it is attached to (under their own
 * branch / assignment scope), in addition to the document's own branch scope. A missing, foreign or invisible document or
 * record is the same 404, so nothing can be learned by guessing ids.
 */
async function accessible(principal: Principal, id: string, includeArchived = true): Promise<{ doc: DocumentLean; entity: ResolvedEntity }> {
  const doc = await repo(principal, undefined, includeArchived).findById(id).lean<DocumentLean>();
  if (!doc) throw AppError.notFound('Document not found');
  const entity = await resolveEntity(principal, doc.entityType, doc.entityId.toHexString());
  if (!entity) throw AppError.notFound('Document not found');
  return { doc, entity };
}

/** For writing to a record: it must be visible and not archived. */
export async function writableEntity(principal: Principal, type: DocumentEntityType, id: string): Promise<ResolvedEntity> {
  const entity = await resolveEntity(principal, type, id);
  if (!entity) throw AppError.notFound(`${DOCUMENT_ENTITIES[type].label} not found`);
  if (entity.isArchived) throw AppError.conflict('ENTITY_ARCHIVED', `This ${DOCUMENT_ENTITIES[type].label.toLowerCase()} is archived, so documents cannot be added to it`);
  return entity;
}

/** Pre-check used by the upload route BEFORE the file body is read. */
export async function assertCanUploadTo(principal: Principal, type: DocumentEntityType, id: string): Promise<void> {
  await writableEntity(principal, type, id);
}
export async function assertCanReplace(principal: Principal, id: string): Promise<void> {
  const { doc, entity } = await accessible(principal, id, false);
  if (entity.isArchived) throw AppError.conflict('ENTITY_ARCHIVED', 'The record is archived');
  void doc;
}

// ---- views ------------------------------------------------------------------------------------

async function lookups(principal: Principal, rows: DocumentLean[]) {
  const masterIds = [...new Set(rows.map((r) => r.documentTypeId.toHexString()))];
  const userIds = [...new Set(rows.flatMap((r) => [r.file.uploadedBy, r.createdBy]).filter(Boolean).map((i) => i!.toHexString()))];
  const branchIds = [...new Set(rows.map((r) => r.branchId.toHexString()))];
  const [masters, users, branches] = await Promise.all([
    masterIds.length ? masterLabels(principal, masterIds) : new Map(), // includes inactive types: history keeps its meaning
    userIds.length ? scopedRepo(User, principal).find({ _id: { $in: userIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [],
    scopedRepo(Branch, principal).find({ _id: { $in: branchIds.map((i) => toObjectId(i)) } }).select('name code').lean<{ _id: Id; name: string; code: string }[]>(),
  ]);
  return { masters, users: new Map(users.map((u) => [u._id.toHexString(), u.name])), branches: new Map(branches.map((b) => [b._id.toHexString(), { name: b.name, code: b.code }])) };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

const fileView = (f: FileLean, l: Lookups) => ({ version: f.version, originalName: f.originalName, mime: f.mime, bytes: f.bytes, format: f.format, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy?.toHexString(), uploadedByName: f.uploadedBy ? l.users.get(f.uploadedBy.toHexString()) : undefined });

/** Never includes a storage key or any URL. */
export function toView(d: DocumentLean, l: Lookups, p: Principal, detail = false) {
  const live = !d.isArchived;
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(p, k);
  return {
    id: d._id.toHexString(), documentNo: d.documentNo, branchId: d.branchId.toHexString(), branch: l.branches.get(d.branchId.toHexString()),
    entityType: d.entityType, entityTypeLabel: DOCUMENT_ENTITIES[d.entityType].label, entityId: d.entityId.toHexString(), entityNo: d.entityNo,
    documentTypeId: d.documentTypeId.toHexString(), type: l.masters.get(d.documentTypeId.toHexString()),
    name: d.name, notes: d.notes ?? undefined, file: fileView(d.file, l), versionCount: d.fileVersion,
    ...(detail ? { previousFiles: (d.previousFiles ?? []).map((x) => ({ ...fileView(x.file, l), replacedAt: x.replacedAt })) } : {}),
    isArchived: Boolean(d.isArchived), createdAt: d.createdAt, updatedAt: d.updatedAt,
    /** What this user may do with this document right now; the UI shows exactly these controls (the API enforces them again). */
    allowed: { download: can('documents.view'), edit: live && can('documents.edit'), replace: live && can('documents.upload'), archive: live && can('documents.archive') },
  };
}

async function viewsOf(principal: Principal, rows: DocumentLean[], detail = false) {
  const l = await lookups(principal, rows);
  return rows.map((r) => toView(r, l, principal, detail));
}

// ---- reads ----------------------------------------------------------------------------------------

export const entityTypes = () => DOCUMENT_ENTITY_TYPES.map((t) => ({ type: t, label: DOCUMENT_ENTITIES[t].label }));

export async function listDocuments(principal: Principal, q: z.infer<typeof listDocumentQuery>) {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  if (q.entityType && q.entityId) {
    // Listing a record's documents: the record must be visible to the caller (no existence oracle: same 404 as a made-up id).
    const entity = await resolveEntity(principal, q.entityType, q.entityId);
    if (!entity) throw AppError.notFound(`${DOCUMENT_ENTITIES[q.entityType].label} not found`);
    and.push({ entityType: q.entityType, entityId: entity.id });
  } else {
    if (q.entityType) and.push({ entityType: q.entityType }); // a record TYPE alone narrows the (scoped) list; it opens nothing
    if (principal.dataScope === 'OWN') and.push({ createdBy: toObjectId(principal.userId) });
  }
  if (q.documentTypeId) and.push({ documentTypeId: toObjectId(q.documentTypeId) });
  if (q.from || q.to) and.push({ createdAt: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } });
  const term = q.search?.trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    const ors: Record<string, unknown>[] = [{ name: rx }, { 'file.originalName': rx }, { documentNo: new RegExp(`^${escapeRegex(term)}`, 'i') }, { entityNo: new RegExp(`^${escapeRegex(term)}`, 'i') }];
    if (/^\d{1,9}$/.test(term)) ors.push({ documentNo: new RegExp(`^DOC-0*${term.replace(/^0+/, '') || '0'}$`) });
    and.push({ $or: ors });
  }
  const filter = { $and: and };
  const r = repo(principal, q.branchId, true);
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['createdAt', 'documentNo', 'name'], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    r.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<DocumentLean[]>(),
    r.countDocuments(filter),
  ]);
  return { rows: await viewsOf(principal, rows), meta: toMeta(q, total) };
}

export async function getDocument(principal: Principal, id: string) {
  const { doc } = await accessible(principal, id);
  return (await viewsOf(principal, [doc], true))[0]!;
}

/** A short-lived, signed link to the file. Generated only after the access check, never stored, never reusable as a plain URL. */
export async function accessUrl(principal: Principal, id: string, version?: number) {
  const { doc } = await accessible(principal, id);
  const file = !version || version === doc.file.version ? doc.file : doc.previousFiles?.find((x) => x.file.version === version)?.file;
  if (!file) throw AppError.notFound('That version of the document does not exist');
  const ttl = getEnv().DOCUMENT_URL_TTL_SECONDS;
  const url = getMediaProvider().signedUrl({ publicId: file.publicId, format: file.format }, ttl);
  await recordAudit({ entityType: 'document', entityId: doc._id, action: 'download', after: { version: file.version }, userId: principal.userId, branchId: doc.branchId }, { bestEffort: true });
  return { url, expiresAt: new Date(Date.now() + ttl * 1000), fileName: file.originalName, mime: file.mime, version: file.version };
}

// ---- file handling -----------------------------------------------------------------------------------

export interface IncomingFile {
  buffer: Buffer;
  originalname: string;
}

/** What the file REALLY is. The browser's MIME type and the name are never trusted: content decides, and the name must agree. */
function inspect(file: IncomingFile | undefined): { format: MediaFormat; mime: string; bytes: number; hash: string; originalName: string } {
  if (!file || file.buffer.length === 0) throw AppError.validation('Choose a file to upload', [{ path: 'file', message: 'Required' }]);
  const format = detectFormat(file.buffer);
  if (!format) throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Only PDF, JPEG, PNG and WebP files are accepted');
  // Names arrive from the browser: keep only a plain, bounded file name (no paths, no control characters).
  const originalName = [...(file.originalname.split(/[\\/]/).pop() ?? '')].filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join('').trim().slice(0, 200);
  if (!originalName) throw AppError.validation('The file has no name', [{ path: 'file', message: 'Required' }]);
  if (!extensionMatches(originalName, format)) throw new AppError('FILE_EXTENSION_MISMATCH', 415, `The file name does not match its contents (it is a ${format.toUpperCase()} file)`);
  return { format, mime: mimeFor(format), bytes: file.buffer.length, hash: createHash('sha256').update(file.buffer).digest('hex'), originalName };
}

const isDuplicate = (e: unknown) => (e as { code?: number })?.code === 11000;
const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{1,8}$/, '');

async function clashError(principal: Principal, type: DocumentEntityType, entityId: Id, hash: string): Promise<AppError> {
  const existing = await repo(principal).findOne({ entityType: type, entityId, contentHash: hash }).select('documentNo').lean<{ documentNo: string }>();
  return AppError.conflict('DUPLICATE_DOCUMENT', existing ? `This file is already attached here (${existing.documentNo})` : 'This file is already attached here', existing ? { documentNo: existing.documentNo } : undefined);
}

// ---- upload ----------------------------------------------------------------------------------------------

export async function uploadDocument(principal: Principal, target: { entityType: DocumentEntityType; entityId: string }, file: IncomingFile | undefined, input: { documentTypeId: string; name?: string; notes?: string }) {
  const entity = await writableEntity(principal, target.entityType, target.entityId);
  const info = inspect(file);
  await assertActiveMaster(principal, 'DOCUMENT_TYPE', input.documentTypeId, 'documentTypeId');
  const branch = entity.branchId.toHexString();
  // Cheap duplicate pre-check (the unique index is the real guard) so an ordinary repeat spends nothing.
  if (await repo(principal).exists({ entityType: target.entityType, entityId: entity.id, contentHash: info.hash })) throw await clashError(principal, target.entityType, entity.id, info.hash);

  const documentNo = await nextDocumentNo(); // atomic; failures only leave a gap
  const asset = await getMediaProvider().upload(file!.buffer, { folder: `${getEnv().CLOUDINARY_FOLDER}/documents/${branch}/${target.entityType}/${entity.id.toHexString()}`, format: info.format, access: 'private' });
  const now = new Date();
  const uid = toObjectId(principal.userId);
  try {
    const created = await withTransaction(async (session) => {
      const doc = await repo(principal).create(
        {
          documentNo, branchId: entity.branchId, entityType: target.entityType, entityId: entity.id, entityNo: entity.number, documentTypeId: toObjectId(input.documentTypeId),
          name: input.name ?? stem(info.originalName), notes: input.notes || undefined, contentHash: info.hash, fileVersion: 1, createdBy: uid,
          file: { version: 1, publicId: asset.publicId, format: info.format, mime: info.mime, bytes: asset.bytes, originalName: info.originalName, uploadedBy: uid, uploadedAt: now },
        },
        { session },
      );
      const d = doc.toObject() as unknown as DocumentLean;
      await recordAudit({ entityType: 'document', entityId: d._id, action: 'upload', after: { documentNo, entityType: d.entityType, entityNo: d.entityNo, documentTypeId: d.documentTypeId, name: d.name, originalName: info.originalName, bytes: info.bytes, mime: info.mime }, userId: principal.userId, branchId: branch }, { session });
      await recordActivity({ type: 'DOCUMENT_UPLOADED', description: `Document ${documentNo} (${d.name}) added to ${DOCUMENT_ENTITIES[d.entityType].label.toLowerCase()} ${d.entityNo}`, branchId: branch, userId: principal.userId, at: now, refs: [{ type: 'document', id: d._id }, { type: d.entityType, id: d.entityId }] }, { session });
      return d;
    });
    return (await viewsOf(principal, [created], true))[0]!;
  } catch (err) {
    await destroyQuietly(asset.publicId, log, 'private'); // nothing references the file: do not leave it behind
    if (isDuplicate(err)) {
      const keys = (err as { keyPattern?: Record<string, unknown> }).keyPattern;
      if (keys && 'contentHash' in keys) throw await clashError(principal, target.entityType, entity.id, info.hash);
    }
    throw err;
  }
}

// ---- replace the file (keeps the old one as history) --------------------------------------------------------------

export async function replaceFile(principal: Principal, id: string, file: IncomingFile | undefined) {
  const { doc, entity } = await accessible(principal, id, false);
  if (entity.isArchived) throw AppError.conflict('ENTITY_ARCHIVED', 'The record is archived, so its documents cannot change');
  const info = inspect(file);
  if (info.hash === doc.contentHash) throw AppError.conflict('SAME_FILE', 'This is the same file that is already attached');
  const branch = doc.branchId.toHexString();
  const asset = await getMediaProvider().upload(file!.buffer, { folder: `${getEnv().CLOUDINARY_FOLDER}/documents/${branch}/${doc.entityType}/${doc.entityId.toHexString()}`, format: info.format, access: 'private' });
  const now = new Date();
  const uid = toObjectId(principal.userId);
  const next: FileLean = { version: doc.fileVersion + 1, publicId: asset.publicId, format: info.format, mime: info.mime, bytes: asset.bytes, originalName: info.originalName, uploadedBy: uid, uploadedAt: now };
  try {
    const updated = await withTransaction(async (session) => {
      // Compare-and-set on the version the caller saw: two simultaneous replacements cannot both succeed.
      const u = await repo(principal)
        .findOneAndUpdate(
          { _id: doc._id, fileVersion: doc.fileVersion },
          { $set: { file: next, fileVersion: next.version, contentHash: info.hash, updatedBy: uid }, $push: { previousFiles: { file: doc.file, replacedAt: now, replacedBy: uid } } },
          { new: true, session },
        )
        .lean<DocumentLean>();
      if (!u) throw AppError.conflict('DOCUMENT_CHANGED', 'The document was changed by someone else. Refresh and try again.');
      await recordAudit({ entityType: 'document', entityId: doc._id, action: 'replace', before: { version: doc.file.version, originalName: doc.file.originalName, bytes: doc.file.bytes }, after: { version: next.version, originalName: next.originalName, bytes: next.bytes }, userId: principal.userId, branchId: branch }, { session });
      await recordActivity({ type: 'DOCUMENT_REPLACED', description: `File of document ${doc.documentNo} replaced (version ${next.version})`, branchId: branch, userId: principal.userId, at: now, refs: [{ type: 'document', id: doc._id }, { type: doc.entityType, id: doc.entityId }] }, { session });
      return u;
    });
    return (await viewsOf(principal, [updated], true))[0]!;
  } catch (err) {
    await destroyQuietly(asset.publicId, log, 'private');
    if (isDuplicate(err)) throw await clashError(principal, doc.entityType, doc.entityId, info.hash);
    throw err;
  }
}

// ---- update / archive -------------------------------------------------------------------------------------------------

export async function updateDocument(principal: Principal, id: string, patch: z.infer<typeof updateDocumentBody>) {
  const { doc } = await accessible(principal, id, false);
  // Only a CHANGED type must be active; an unchanged (possibly since-deactivated) one stays valid.
  if (patch.documentTypeId && patch.documentTypeId !== doc.documentTypeId.toHexString()) await assertActiveMaster(principal, 'DOCUMENT_TYPE', patch.documentTypeId, 'documentTypeId');
  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  if (patch.documentTypeId) set.documentTypeId = toObjectId(patch.documentTypeId);
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.notes === null) unset.notes = 1;
  else if (patch.notes !== undefined) set.notes = patch.notes;
  const branch = doc.branchId.toHexString();
  const after = await withTransaction(async (session) => {
    const u = await repo(principal).findOneAndUpdate({ _id: doc._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session }).lean<DocumentLean>();
    if (!u) throw AppError.notFound('Document not found');
    const pick = (x: DocumentLean) => ({ documentTypeId: x.documentTypeId, name: x.name, notes: x.notes });
    await recordAudit({ entityType: 'document', entityId: doc._id, action: 'update', before: pick(doc), after: pick(u), userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'DOCUMENT_UPDATED', description: `Document ${doc.documentNo} updated`, branchId: branch, userId: principal.userId, refs: [{ type: 'document', id: doc._id }, { type: doc.entityType, id: doc.entityId }] }, { session });
    return u;
  });
  return (await viewsOf(principal, [after], true))[0]!;
}

/** Soft archive: hidden from normal lists, kept (with its files and history) for authorized historical views. */
export async function archiveDocument(principal: Principal, id: string) {
  const { doc } = await accessible(principal, id, false);
  const branch = doc.branchId.toHexString();
  await withTransaction(async (session) => {
    if (!(await repo(principal).archiveOne({ _id: doc._id }, principal.userId, { session }))) throw AppError.notFound('Document not found');
    await recordAudit({ entityType: 'document', entityId: doc._id, action: 'archive', before: { isArchived: false }, after: { isArchived: true }, userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'DOCUMENT_ARCHIVED', description: `Document ${doc.documentNo} (${doc.name}) archived`, branchId: branch, userId: principal.userId, refs: [{ type: 'document', id: doc._id }, { type: doc.entityType, id: doc.entityId }] }, { session });
  });
}

/** Timeline authorization: the document's events are readable by whoever may access the document (archived included). */
export async function canSee(principal: Principal, id: string): Promise<boolean> {
  try {
    await accessible(principal, id, true);
    return true;
  } catch {
    return false;
  }
}
