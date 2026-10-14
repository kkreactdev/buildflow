/* eslint-disable @typescript-eslint/no-explicit-any --
   The repo is a thin pass-through over arbitrary Mongoose models. */
import type { ClientSession, Model } from 'mongoose';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import type { Principal } from '../permissions/principal';
import { attachGrant, runWithGrant, ScopeGrant } from './grant';
import { getScopeSpec } from './scopePlugin';
import { allowedBranchSet, resolveScope, resolveWriteScope, type ScopeOptions } from './scopeResolver';

type AnyModel = Model<any>;
type Filter = Record<string, unknown>;

export interface RepoOptions extends ScopeOptions {
  /** Include soft-deleted (archived) records. Default false. */
  includeArchived?: boolean;
}

/**
 * The data-access object feature code uses instead of the bare Mongoose model.
 * Every method mirrors its Mongoose namesake and attaches a ScopeGrant, which
 * the scope plugin turns into an enforced filter/validation. Because the bare
 * model refuses to run without a grant, writing an unscoped query by accident
 * is not possible: it throws instead of leaking.
 *
 * Build one per request: `scopedRepo(Enquiry, req.principal!, { requestedBranchId })`.
 */
export class ScopedRepo<M extends AnyModel> {
  /** @internal use scopedRepo()/systemRepo() */
  constructor(
    readonly model: M,
    private readonly grant: ScopeGrant,
    private readonly opts: RepoOptions = {},
  ) {}

  private get hasArchive(): boolean {
    return Boolean(this.model.schema.path('isArchived'));
  }

  /** Adds the default "not archived" condition. Scope itself is added by the plugin, not here. */
  private f(filter: Filter = {}): Filter {
    return this.hasArchive && !this.opts.includeArchived ? { $and: [filter, { isArchived: { $ne: true } }] } : filter;
  }

  private q<T extends object>(query: T, session?: ClientSession): T {
    attachGrant(query, this.grant);
    if (session) (query as any).session(session);
    return query;
  }

  // ---- reads / queries ----------------------------------------------------
  // Typed as the model's own signatures so results keep their field types.
  readonly find: M['find'] = ((filter?: Filter, ...rest: any[]) => this.q((this.model as any).find(this.f(filter), ...rest))) as any;
  readonly findOne: M['findOne'] = ((filter?: Filter, ...rest: any[]) => this.q((this.model as any).findOne(this.f(filter), ...rest))) as any;
  readonly countDocuments: M['countDocuments'] = ((filter?: Filter, ...rest: any[]) => this.q((this.model as any).countDocuments(this.f(filter), ...rest))) as any;
  readonly distinct: M['distinct'] = ((field: string, filter?: Filter, ...rest: any[]) => this.q((this.model as any).distinct(field, this.f(filter), ...rest))) as any;
  readonly updateOne: M['updateOne'] = ((filter: Filter, ...rest: any[]) => this.q((this.model as any).updateOne(this.f(filter), ...rest))) as any;
  readonly updateMany: M['updateMany'] = ((filter: Filter, ...rest: any[]) => this.q((this.model as any).updateMany(this.f(filter), ...rest))) as any;
  readonly findOneAndUpdate: M['findOneAndUpdate'] = ((filter: Filter, ...rest: any[]) => this.q((this.model as any).findOneAndUpdate(this.f(filter), ...rest))) as any;
  readonly deleteOne: M['deleteOne'] = ((filter: Filter, ...rest: any[]) => this.q((this.model as any).deleteOne(this.f(filter), ...rest))) as any;
  readonly deleteMany: M['deleteMany'] = ((filter: Filter, ...rest: any[]) => this.q((this.model as any).deleteMany(this.f(filter), ...rest))) as any;
  readonly findOneAndDelete: M['findOneAndDelete'] = ((filter: Filter, ...rest: any[]) => this.q((this.model as any).findOneAndDelete(this.f(filter), ...rest))) as any;
  /** Only system grants may use this (an unfiltered count cannot be scoped); the plugin refuses it otherwise. */
  readonly estimatedDocumentCount: M['estimatedDocumentCount'] = ((...rest: any[]) => this.q((this.model as any).estimatedDocumentCount(...rest))) as any;
  readonly exists: M['exists'] = ((filter: Filter) => this.q((this.model as any).findOne(this.f(filter)).select('_id').lean())) as any;

  /** Same scope as everything else: a foreign id simply is not found. */
  readonly findById: M['findById'] = ((id: unknown, ...rest: any[]) => (this.findOne as any)({ _id: toObjectId(String(id)) }, ...rest)) as any;

  /** The scope `$match` is prepended automatically; joins into other scoped collections are refused. */
  readonly aggregate: M['aggregate'] = ((pipeline: any[] = [], ...rest: any[]) => {
    const stages = this.hasArchive && !this.opts.includeArchived ? [{ $match: { isArchived: { $ne: true } } }, ...pipeline] : pipeline;
    return this.q((this.model as any).aggregate(stages, ...rest));
  }) as any;

  /**
   * Soft delete: sets isArchived/archivedAt/archivedBy on ONE in-scope record.
   * Returns false when nothing in scope matched (including other branches' records).
   */
  async archiveOne(filter: Filter, by: string, options?: { session?: ClientSession }): Promise<boolean> {
    if (!this.hasArchive) throw new Error(`Model ${this.model.modelName} has no isArchived field`);
    const res: any = await this.q(
      (this.model as any).updateOne(this.f(filter), { $set: { isArchived: true, archivedAt: new Date(), archivedBy: toObjectId(by) } }),
      options?.session,
    );
    return res.modifiedCount === 1;
  }

  /** New documents. The plugin verifies the branch field is inside the actor's scope. */
  async create(data: Record<string, unknown>, options?: { session?: ClientSession }): Promise<InstanceType<M>> {
    const doc = new this.model(data);
    await runWithGrant(this.grant, () => doc.save(options));
    return doc as any;
  }

  /** Saves a document previously loaded through this repo. Re-checks it is still in scope first. */
  async save(doc: InstanceType<M>, options?: { session?: ClientSession }): Promise<InstanceType<M>> {
    const d = doc as any;
    if (!(d instanceof this.model)) throw new Error('save(): document belongs to a different model');
    if (!d.isNew && !(await this.exists({ _id: d._id }))) throw AppError.notFound();
    await runWithGrant(this.grant, () => d.save(options));
    return doc;
  }

  insertMany(docs: Record<string, unknown>[], options?: any): Promise<unknown> {
    return runWithGrant(this.grant, () => this.model.insertMany(docs, options) as Promise<unknown>);
  }

  bulkWrite(ops: any[], options?: any): ReturnType<M['bulkWrite']> {
    return runWithGrant(this.grant, () => this.model.bulkWrite(ops, options)) as any;
  }
}

/**
 * The normal entry point. Scope comes from the authenticated principal (built
 * from the database), the model's declared spec, and an optional client
 * narrowing that can only shrink the result.
 */
export function scopedRepo<M extends AnyModel>(model: M, principal: Principal, opts: RepoOptions = {}): ScopedRepo<M> {
  const spec = getScopeSpec(model.schema);
  if (!spec) throw new Error(`Model ${model.modelName} is not branch-scoped (scopePlugin not applied)`);
  const withReq = { ...spec, requestedBranchId: opts.requestedBranchId };
  const grant = ScopeGrant.scoped(resolveScope(principal, withReq), resolveWriteScope(principal, withReq), allowedBranchSet(principal), `user:${principal.userId}`);
  return new ScopedRepo(model, grant, opts);
}
