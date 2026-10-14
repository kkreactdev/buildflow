import { Types, type Model } from 'mongoose';
import type { Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';

/**
 * Moves dates of a record the demo seed ITSELF just created into the past (the API only accepts future schedules, and
 * `createdAt` is immutable). It goes through the scoped repository as the signed-in Super Admin, so no scope bypass is
 * involved, and it refuses ids the seed did not create in this run.
 */
export async function backdate<T extends Model<any>>(model: T, principal: Principal, created: ReadonlySet<string>, id: string, set: Record<string, Date>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!created.has(id)) throw new Error('refusing to back-date a record this run did not create');
  await scopedRepo(model, principal, { includeArchived: true }).updateOne({ _id: new Types.ObjectId(id) }, { $set: set }, { overwriteImmutable: true, timestamps: false });
}
