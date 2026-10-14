import type { Types } from 'mongoose';
import type { z } from 'zod';
import { recordAudit } from '../../core/audit/audit.service';
import { assertPermission, hasPermission, type Principal } from '../../core/permissions/principal';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { analyzeTemplate, TEMPLATE_VARIABLES } from '../../lib/templateVariables';
import { withTransaction } from '../../lib/transaction';
import { assertActiveMaster, masterLabels } from '../masters/master.service';
import { WhatsAppTemplate } from './whatsappTemplate.model';
import './whatsappTemplate.references';
import type { createTemplateBody, listTemplateQuery, updateTemplateBody } from './whatsappTemplate.schema';

type Id = Types.ObjectId;
type Lean = { _id: Id; name: string; nameKey: string; categoryId: Id; eventId: Id; body: string; variables: string[]; isActive: boolean; isArchived?: boolean; createdAt?: Date; updatedAt?: Date };

/**
 * Templates are company-wide (like the global WhatsApp masters), so changing them needs the manage permission AND access to all
 * branches. Reading needs the view permission only and shows everyone the same list.
 */
export function assertCanManageTemplates(principal: Principal | undefined): asserts principal is Principal {
  assertPermission(principal, 'whatsapp_masters.manage');
  if (principal.dataScope !== 'ALL') throw AppError.forbidden('WhatsApp templates are company-wide and can only be changed by users with access to all branches');
}

export const variableList = () => TEMPLATE_VARIABLES.map((v) => ({ ...v, token: `{{${v.key}}}` }));

/** Reports every placeholder problem together as field errors on `body`. */
function checkBody(body: string): string[] {
  const { variables, issues } = analyzeTemplate(body);
  if (issues.length) throw AppError.validation('The message has invalid placeholders', issues.map((i) => ({ path: 'body', message: i.message })));
  return variables;
}

const keyOf = (name: string) => name.trim().toLowerCase();
const auditView = (t: Lean) => ({ name: t.name, categoryId: t.categoryId, eventId: t.eventId, body: t.body, variables: t.variables, isActive: t.isActive });

async function toViews(principal: Principal, rows: Lean[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.categoryId, r.eventId]).map((i) => i.toHexString()))];
  const masters = ids.length ? await masterLabels(principal, ids) : new Map(); // includes inactive values: a template keeps its meaning
  const can = hasPermission(principal, 'whatsapp_masters.manage') && principal.dataScope === 'ALL';
  return rows.map((t) => ({
    id: t._id.toHexString(), name: t.name, categoryId: t.categoryId.toHexString(), category: masters.get(t.categoryId.toHexString()),
    eventId: t.eventId.toHexString(), event: masters.get(t.eventId.toHexString()), body: t.body, variables: t.variables, isActive: t.isActive,
    isArchived: Boolean(t.isArchived), createdAt: t.createdAt, updatedAt: t.updatedAt,
    allowed: { edit: can && !t.isArchived, archive: can && !t.isArchived },
  }));
}

export async function listTemplates(principal: Principal, q: z.infer<typeof listTemplateQuery>) {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  if (q.categoryId) and.push({ categoryId: toObjectId(q.categoryId) });
  if (q.eventId) and.push({ eventId: toObjectId(q.eventId) });
  if (q.isActive) and.push({ isActive: q.isActive === 'true' });
  const term = q.search?.trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    and.push({ $or: [{ name: rx }, { body: rx }] });
  }
  const filter = { $and: and };
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['createdAt', 'name'], { name: 1 });
  const [rows, total] = await Promise.all([
    WhatsAppTemplate.find(filter).sort({ ...sort, _id: 1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<Lean[]>(),
    WhatsAppTemplate.countDocuments(filter),
  ]);
  return { rows: await toViews(principal, rows), meta: toMeta(q, total) };
}

export async function getTemplate(principal: Principal, id: string) {
  const t = await WhatsAppTemplate.findById(toObjectId(id)).lean<Lean>();
  if (!t) throw AppError.notFound('Template not found');
  return (await toViews(principal, [t]))[0]!;
}

const clash = () => AppError.conflict('TEMPLATE_NAME_TAKEN', 'A template with this name already exists for that event');

export async function createTemplate(principal: Principal, input: z.infer<typeof createTemplateBody>) {
  assertCanManageTemplates(principal);
  const variables = checkBody(input.body);
  await assertActiveMaster(principal, 'WA_CATEGORY', input.categoryId, 'categoryId');
  await assertActiveMaster(principal, 'WA_EVENT', input.eventId, 'eventId');
  try {
    const created = await withTransaction(async (session) => {
      const [doc] = await WhatsAppTemplate.create([{ name: input.name, nameKey: keyOf(input.name), categoryId: toObjectId(input.categoryId), eventId: toObjectId(input.eventId), body: input.body, variables, isActive: input.isActive, createdBy: toObjectId(principal.userId) }], { session });
      const t = doc!.toObject() as unknown as Lean;
      await recordAudit({ entityType: 'whatsappTemplate', entityId: t._id, action: 'create', after: auditView(t), userId: principal.userId }, { session });
      return t;
    });
    return (await toViews(principal, [created]))[0]!;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw clash();
    throw err;
  }
}

export async function updateTemplate(principal: Principal, id: string, patch: z.infer<typeof updateTemplateBody>) {
  assertCanManageTemplates(principal);
  const before = await WhatsAppTemplate.findOne({ _id: toObjectId(id), isArchived: { $ne: true } }).lean<Lean>();
  if (!before) throw AppError.notFound('Template not found');
  // Only a CHANGED category / event must be active: a template whose master was retired later stays editable.
  if (patch.categoryId && patch.categoryId !== before.categoryId.toHexString()) await assertActiveMaster(principal, 'WA_CATEGORY', patch.categoryId, 'categoryId');
  if (patch.eventId && patch.eventId !== before.eventId.toHexString()) await assertActiveMaster(principal, 'WA_EVENT', patch.eventId, 'eventId');
  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  if (patch.name !== undefined) Object.assign(set, { name: patch.name, nameKey: keyOf(patch.name) });
  if (patch.categoryId) set.categoryId = toObjectId(patch.categoryId);
  if (patch.eventId) set.eventId = toObjectId(patch.eventId);
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  if (patch.body !== undefined) Object.assign(set, { body: patch.body, variables: checkBody(patch.body) });
  try {
    const after = await withTransaction(async (session) => {
      const t = await WhatsAppTemplate.findOneAndUpdate({ _id: before._id, isArchived: { $ne: true } }, { $set: set }, { new: true, session }).lean<Lean>();
      if (!t) throw AppError.notFound('Template not found');
      await recordAudit({ entityType: 'whatsappTemplate', entityId: before._id, action: 'update', before: auditView(before), after: auditView(t), userId: principal.userId }, { session });
      return t;
    });
    return (await toViews(principal, [after]))[0]!;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw clash();
    throw err;
  }
}

/** Soft archive: the template disappears from normal lists but is kept (it may have been used), freeing its name. */
export async function archiveTemplate(principal: Principal, id: string) {
  assertCanManageTemplates(principal);
  const before = await WhatsAppTemplate.findOne({ _id: toObjectId(id), isArchived: { $ne: true } }).lean<Lean>();
  if (!before) throw AppError.notFound('Template not found');
  await withTransaction(async (session) => {
    const done = await WhatsAppTemplate.updateOne({ _id: before._id, isArchived: { $ne: true } }, { $set: { isArchived: true, archivedAt: new Date(), archivedBy: toObjectId(principal.userId), isActive: false } }, { session });
    if (done.modifiedCount !== 1) throw AppError.notFound('Template not found');
    await recordAudit({ entityType: 'whatsappTemplate', entityId: before._id, action: 'archive', before: { isArchived: false, isActive: before.isActive }, after: { isArchived: true, isActive: false }, userId: principal.userId }, { session });
  });
}
