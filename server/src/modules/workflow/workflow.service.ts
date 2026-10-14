import type { ClientSession, Types } from 'mongoose';
import type { z } from 'zod';
import { recordAudit } from '../../core/audit/audit.service';
import { assertPermission, type Principal } from '../../core/permissions/principal';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { withTransaction } from '../../lib/transaction';
import { WorkflowDefinition, type StageView } from './workflow.definition';
import { WorkflowStage } from './workflow.model';
import type { createStageBody, reorderStagesBody, updateStageBody } from './workflow.schema';
import { CANONICAL_FLOW_KEYS, FIRST_STAGE, LAST_STAGE } from './workflowDefaults';

type Lean = {
  _id: Types.ObjectId; systemKey: string; label: string; description?: string | null; color?: string | null; order: number;
  kind: 'FLOW' | 'LOST'; entryPolicy: 'MANUAL' | 'DOMAIN'; domainOperation?: string | null; isSystem: boolean; isActive: boolean;
};

const toView = (s: Lean): StageView => ({
  id: s._id.toHexString(), systemKey: s.systemKey, label: s.label, order: s.order, kind: s.kind,
  entryPolicy: s.entryPolicy, domainOperation: s.domainOperation ?? undefined, isActive: s.isActive, isSystem: s.isSystem,
});

const auditView = (s: Lean) => ({ label: s.label, description: s.description, color: s.color, order: s.order, isActive: s.isActive });

/** Pipeline configuration is company-wide: changing it needs `masters.manage` AND access to all branches. */
export function assertCanManageWorkflow(principal: Principal | undefined): asserts principal is Principal {
  assertPermission(principal, 'masters.manage');
  if (principal.dataScope !== 'ALL') throw AppError.forbidden('The workflow is company-wide and can only be changed by users with access to all branches');
}

const sortStages = (rows: Lean[]) => [...rows].sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === 'FLOW' ? -1 : 1));

export async function listStages(includeInactive = true) {
  const rows = await WorkflowStage.find(includeInactive ? {} : { isActive: true }).lean<Lean[]>();
  return sortStages(rows);
}

/** Loads the current configuration as a state machine. This is what the Enquiry module will call. */
export async function loadWorkflow(): Promise<WorkflowDefinition> {
  const rows = await WorkflowStage.find({}).lean<Lean[]>();
  return new WorkflowDefinition(rows.map(toView));
}

const slug = (label: string) => label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'STAGE';

async function assertLabelFree(label: string, exceptId?: Types.ObjectId) {
  const rows = await WorkflowStage.find({}).select('label').lean<{ _id: Types.ObjectId; label: string }[]>();
  if (rows.some((r) => r.label.toLowerCase() === label.toLowerCase() && !r._id.equals(exceptId ?? ''))) {
    throw AppError.conflict('STAGE_LABEL_TAKEN', 'Another stage already has this name');
  }
}

async function writeOrders(flow: { _id: Types.ObjectId; order: number }[], session: ClientSession, principal: Principal, audit: boolean) {
  const changed = flow.map((s, i) => ({ s, to: i + 1 })).filter(({ s, to }) => s.order !== to);
  if (changed.length) {
    await WorkflowStage.bulkWrite(changed.map(({ s, to }) => ({ updateOne: { filter: { _id: s._id }, update: { $set: { order: to, updatedBy: toObjectId(principal.userId) } } } })), { session });
    if (audit) for (const { s, to } of changed) await recordAudit({ entityType: 'workflowStage', entityId: s._id, action: 'reorder', before: { order: s.order }, after: { order: to }, userId: principal.userId }, { session });
  }
}

/** Adds an intermediate stage right after an existing one. The canonical stages keep their relative order. */
export async function createStage(principal: Principal, input: z.infer<typeof createStageBody>) {
  assertCanManageWorkflow(principal);
  return withTransaction(async (session) => {
    const flow = (await WorkflowStage.find({ kind: 'FLOW' }).session(session).sort({ order: 1 }).lean<Lean[]>());
    const idx = flow.findIndex((s) => s.systemKey === input.afterSystemKey);
    if (idx === -1) throw AppError.validation('Unknown stage to insert after', [{ path: 'afterSystemKey', message: 'Choose an existing pipeline stage' }]);
    if (flow[idx]!.systemKey === LAST_STAGE) throw AppError.validation('Nothing can be added after the final stage', [{ path: 'afterSystemKey', message: `Insert before ${LAST_STAGE}` }]);
    await assertLabelFree(input.label);

    const taken = new Set((await WorkflowStage.find({}).select('systemKey').lean<{ systemKey: string }[]>()).map((s) => s.systemKey));
    let systemKey = `CUSTOM_${slug(input.label)}`;
    for (let n = 2; taken.has(systemKey); n++) systemKey = `CUSTOM_${slug(input.label)}_${n}`;

    const [doc] = await WorkflowStage.create([{ systemKey, label: input.label, description: input.description, color: input.color, order: idx + 1.5, kind: 'FLOW', entryPolicy: 'MANUAL', isSystem: false, isActive: true, createdBy: toObjectId(principal.userId) }], { session });
    const ordered = [...flow.slice(0, idx + 1), doc!.toObject() as unknown as Lean, ...flow.slice(idx + 1)];
    await writeOrders(ordered, session, principal, false);
    const created = (await WorkflowStage.findById(doc!._id).session(session).lean<Lean>())!;
    await recordAudit({ entityType: 'workflowStage', entityId: created._id, action: 'create', after: { systemKey, ...auditView(created) }, userId: principal.userId }, { session });
    return created;
  });
}

export async function updateStage(principal: Principal, id: string, patch: z.infer<typeof updateStageBody>) {
  assertCanManageWorkflow(principal);
  const before = await WorkflowStage.findById(toObjectId(id)).lean<Lean>();
  if (!before) throw AppError.notFound('Stage not found');
  if (patch.isActive === false && before.isSystem) {
    throw AppError.conflict('SYSTEM_STAGE', `"${before.label}" is a core pipeline stage and cannot be deactivated`);
  }
  if (patch.label) await assertLabelFree(patch.label, before._id);

  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(patch)) (v === null ? unset : set)[k] = v === null ? 1 : v;
  const after = await WorkflowStage.findByIdAndUpdate(before._id, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true }).lean<Lean>();
  if (!after) throw AppError.notFound('Stage not found');

  const action = patch.isActive === false && before.isActive ? 'deactivate' : patch.isActive === true && !before.isActive ? 'activate' : 'update';
  await recordAudit({ entityType: 'workflowStage', entityId: before._id, action, before: { systemKey: before.systemKey, ...auditView(before) }, after: { systemKey: after.systemKey, ...auditView(after) }, userId: principal.userId });
  return after;
}

/**
 * Reorders the FLOW chain. Custom stages may be placed anywhere that keeps the
 * canonical stages in their canonical relative order, NEW first and CONVERTED last.
 */
export async function reorderStages(principal: Principal, input: z.infer<typeof reorderStagesBody>) {
  assertCanManageWorkflow(principal);
  return withTransaction(async (session) => {
    const flow = await WorkflowStage.find({ kind: 'FLOW' }).session(session).lean<Lean[]>();
    const byId = new Map(flow.map((s) => [s._id.toHexString(), s]));
    if (byId.size !== input.ids.length || !input.ids.every((i) => byId.has(i))) {
      throw AppError.conflict('REORDER_MISMATCH', 'The pipeline changed since you loaded it. Refresh and try again.');
    }
    const ordered = input.ids.map((i) => byId.get(i)!);
    const keys = ordered.map((s) => s.systemKey);
    const canonical = keys.filter((k) => CANONICAL_FLOW_KEYS.includes(k));
    if (keys[0] !== FIRST_STAGE) throw new AppError('INVALID_ORDER', 409, `${FIRST_STAGE} must stay the first stage`);
    if (keys[keys.length - 1] !== LAST_STAGE) throw new AppError('INVALID_ORDER', 409, `${LAST_STAGE} must stay the last stage`);
    if (canonical.join() !== CANONICAL_FLOW_KEYS.join()) throw new AppError('INVALID_ORDER', 409, 'Core pipeline stages must keep their order; only custom stages can be moved between them');
    await writeOrders(ordered, session, principal, true);
    return (await WorkflowStage.find({ kind: 'FLOW' }).session(session).sort({ order: 1 }).lean<Lean[]>());
  });
}
