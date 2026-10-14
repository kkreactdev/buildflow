/* eslint-disable @typescript-eslint/no-explicit-any --
   Mongoose's middleware typings are loose (`this` is a Query/Aggregate/Document
   depending on the hook), so this file narrows by hand. */
import mongoose, { type Schema } from 'mongoose';
import { AppError } from '../../lib/appError';
import { currentGrant, grantOf, ScopeRequiredError, type ScopeGrant } from './grant';
import type { ScopeSpec } from './scopeResolver';

/**
 * Mongoose scope protection.
 *
 * Applying `scopePlugin` to a schema makes the model FAIL CLOSED: every read,
 * write, count, aggregate, bulk or document operation must carry a ScopeGrant
 * (from `scopedRepo` / `systemRepo`) or it throws `SCOPE_REQUIRED` before
 * touching the database. With a grant, the grant's filter is ANDed into the
 * query (merged with `$and`, so a caller-supplied `_id` or `branchId` can never
 * clobber it) and writes are checked so a record cannot be created in, moved
 * to, or re-pointed at a branch outside the actor's scope.
 *
 * Intentionally NOT covered (documented limits, see implementation plan):
 * the raw driver (`Model.collection`, `mongoose.connection.db`) and
 * `.populate()` sub-queries into scoped models (these fail closed).
 */

const specs = new WeakMap<Schema, ScopeSpec>();
export const SCOPED_MODEL_FLAG = Symbol.for('bf.scoped');

export function getScopeSpec(schema: Schema): ScopeSpec | undefined {
  return specs.get(schema);
}

const QUERY_OPS = [
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'countDocuments', 'distinct',
] as const;
const WRITE_QUERY_OPS = new Set(['findOneAndUpdate', 'findOneAndReplace', 'updateOne', 'updateMany', 'replaceOne']);
/** Operations that modify or remove: they use the grant's (stricter, for shared models) write filter. */
const MUTATING_OPS = new Set([...WRITE_QUERY_OPS, 'deleteOne', 'deleteMany', 'findOneAndDelete']);

const idStr = (v: unknown): string => String(v);

/** Collection names of every scoped model, resolved lazily (models register after plugins run). */
function scopedCollections(): Set<string> {
  const out = new Set<string>();
  for (const model of Object.values(mongoose.models)) {
    if ((model.schema as any)[SCOPED_MODEL_FLAG]) out.add(model.collection.collectionName);
  }
  return out;
}

function flatten(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === 'object' && !('toHexString' in value)) {
    const v = value as Record<string, unknown>;
    if ('$each' in v) return flatten(v.$each);
    if ('$in' in v) return flatten(v.$in);
  }
  return value === undefined || value === null ? [] : [value];
}

function touches(path: string, field: string): boolean {
  return path === field || path.startsWith(`${field}.`);
}

function assertBranchesAllowed(values: unknown[], grant: ScopeGrant, what: string): void {
  if (!grant.allowedBranches) return;
  for (const v of values) {
    if (!grant.allowedBranches.has(idStr(v))) throw AppError.forbidden(`${what}: you do not have access to that branch`);
  }
}

/**
 * Updates may not move/attach a record to a branch outside the actor's scope.
 * Non-ALL actors: `$set`/replacement of the branch field must stay inside scope;
 * `$addToSet`/`$push`/`$pull` values must too; `$unset`/`$rename`/pipeline updates are refused.
 */
function assertUpdateSafe(update: unknown, spec: ScopeSpec, grant: ScopeGrant, model: string): void {
  if (grant.isSystem || !grant.allowedBranches || spec.branchField === '_id') return;
  const field = spec.branchField;
  if (Array.isArray(update)) throw AppError.forbidden(`Aggregation-pipeline updates are not allowed on scoped model "${model}"`);
  if (!update || typeof update !== 'object') return;

  for (const [key, value] of Object.entries(update as Record<string, unknown>)) {
    if (!key.startsWith('$')) {
      if (touches(key, field)) assertBranchesAllowed(flatten(value), grant, `${model}.${field}`);
      continue;
    }
    const body = value as Record<string, unknown>;
    for (const [path, v] of Object.entries(body ?? {})) {
      if (!touches(path, field)) continue;
      if (['$set', '$setOnInsert', '$addToSet', '$push', '$pull', '$pullAll'].includes(key)) {
        assertBranchesAllowed(flatten(v), grant, `${model}.${field}`);
      } else {
        throw AppError.forbidden(`Operator ${key} on ${model}.${field} is not allowed for your scope`);
      }
    }
  }
}

function assertDocumentBranches(doc: Record<string, any>, spec: ScopeSpec, grant: ScopeGrant, model: string, isNew: boolean): void {
  if (grant.isSystem || !grant.allowedBranches) return;
  const raw = doc[spec.branchField];
  const values = flatten(Array.isArray(raw) ? [...raw] : raw);
  const modified = typeof doc.isModified === 'function' ? doc.isModified(spec.branchField) : true;
  if (!isNew && !modified) return;
  if (values.length === 0) throw AppError.forbidden(`${model} must belong to at least one of your branches`);
  assertBranchesAllowed(values, grant, `${model}.${spec.branchField}`);
}

const PINNED_FIRST = new Set(['$geoNear', '$search', '$searchMeta', '$vectorSearch', '$collStats', '$indexStats', '$currentOp', '$listSessions', '$documents', '$listLocalSessions']);

/** Rejects stages that would escape the scope: writes, and joins into other scoped collections. */
function assertPipelineSafe(pipeline: any[], scoped: Set<string>, model: string): void {
  for (const stage of pipeline) {
    const [name, body] = Object.entries(stage)[0] ?? [];
    if (!name) continue;
    if (name === '$out' || name === '$merge') throw AppError.forbidden(`${name} is not allowed on scoped model "${model}"`);
    const from = name === '$lookup' || name === '$graphLookup' ? (body as any).from : name === '$unionWith' ? (typeof body === 'string' ? body : (body as any).coll) : undefined;
    if (from && scoped.has(typeof from === 'object' ? from.coll : from)) {
      throw AppError.forbidden(`${name} into scoped collection "${from}" is not allowed in a scoped aggregate; query it through its own scoped repo`);
    }
    if (name === '$facet') for (const sub of Object.values(body as Record<string, any[]>)) assertPipelineSafe(sub, scoped, model);
    const nested = (body as any)?.pipeline;
    if (Array.isArray(nested)) assertPipelineSafe(nested, scoped, model);
  }
}

export function scopePlugin(schema: Schema, spec: ScopeSpec): void {
  specs.set(schema, spec);
  (schema as any)[SCOPED_MODEL_FLAG] = true;

  // --- queries -----------------------------------------------------------
  schema.pre(QUERY_OPS as any, function (this: any) {
    const model: string = this.model.modelName;
    const grant = grantOf(this);
    if (!grant) throw new ScopeRequiredError(model, this.op);
    const filter = MUTATING_OPS.has(this.op) ? grant.writeFilter : grant.filter;
    if (!grant.isSystem && Object.keys(filter).length) {
      this.setQuery({ $and: [this.getFilter(), filter] });
    }
    if (WRITE_QUERY_OPS.has(this.op) && !grant.isSystem) {
      if (this.getOptions().upsert) throw AppError.forbidden(`upsert is not allowed on scoped model "${model}"`);
      if (this.op === 'replaceOne' || this.op === 'findOneAndReplace') {
        assertDocumentBranches(this.getUpdate() ?? {}, spec, grant, model, true);
      } else assertUpdateSafe(this.getUpdate(), spec, grant, model);
    }
  });

  schema.pre('estimatedDocumentCount' as any, function (this: any) {
    const grant = grantOf(this);
    if (!grant) throw new ScopeRequiredError(this.model.modelName, 'estimatedDocumentCount');
    if (!grant.isSystem) throw AppError.forbidden('estimatedDocumentCount cannot be scoped; use countDocuments');
  });

  // --- aggregate ---------------------------------------------------------
  schema.pre('aggregate', function (this: any) {
    const model: string = this._model?.modelName ?? 'unknown';
    const grant = grantOf(this);
    if (!grant) throw new ScopeRequiredError(model, 'aggregate');
    if (grant.isSystem) return;
    const pipeline: any[] = this.pipeline();
    assertPipelineSafe(pipeline, scopedCollections(), model);
    if (Object.keys(grant.filter).length) {
      const first = Object.keys(pipeline[0] ?? {})[0];
      if (first && PINNED_FIRST.has(first)) throw AppError.forbidden(`${first} cannot be scoped; it must be the first stage`);
      pipeline.unshift({ $match: grant.filter });
    }
  });

  // --- documents / immediate operations (grant travels in async context) ---
  schema.pre('save', function (this: any) {
    const grant = currentGrant();
    if (!grant) throw new ScopeRequiredError(this.constructor.modelName, 'save');
    assertDocumentBranches(this, spec, grant, this.constructor.modelName, this.isNew);
  });

  for (const op of ['deleteOne', 'updateOne'] as const) {
    schema.pre(op, { document: true, query: false }, function (this: any) {
      // Document-level deleteOne/updateOne bypass query scoping; use the repo's query methods.
      throw new ScopeRequiredError(this.constructor.modelName, `document.${op}`);
    });
  }

  schema.pre('insertMany' as any, function (this: any, next: () => void, docs: any[]) {
    const model: string = this.modelName;
    const grant = currentGrant();
    if (!grant) throw new ScopeRequiredError(model, 'insertMany');
    for (const d of docs) assertDocumentBranches(d, spec, grant, model, true);
    next();
  });

  schema.pre('bulkWrite' as any, function (this: any, next: () => void, ops: any[]) {
    const model: string = this.modelName;
    const grant = currentGrant();
    if (!grant) throw new ScopeRequiredError(model, 'bulkWrite');
    if (!grant.isSystem) {
      for (const op of ops) {
        const [kind, body] = Object.entries(op)[0] as [string, any];
        if (kind === 'insertOne') assertDocumentBranches(body.document, spec, grant, model, true);
        else {
          if (body.upsert) throw AppError.forbidden(`upsert is not allowed on scoped model "${model}"`);
          if (Object.keys(grant.writeFilter).length) body.filter = { $and: [body.filter ?? {}, grant.writeFilter] };
          if (kind === 'replaceOne') assertDocumentBranches(body.replacement, spec, grant, model, true);
          else if (kind === 'updateOne' || kind === 'updateMany') assertUpdateSafe(body.update, spec, grant, model);
        }
      }
    }
    next();
  });
}

/** Schema fragments for the branch-ownership convention every future branch-scoped module uses. */
export const branchOwnedFields = {
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
} as const;

export const softDeleteFields = {
  isArchived: { type: Boolean, default: false },
  archivedAt: { type: Date },
  archivedBy: { type: mongoose.Schema.Types.ObjectId },
} as const;
