import { recordAudit } from '../core/audit/audit.service';
import { systemRepo } from '../core/scope/system';
import { Master } from '../modules/masters/master.model';
import { MASTER_SEEDS } from '../seeds/masterSeed';

/**
 * Activity types added after a database was first seeded would fail at runtime with
 * `Unknown activity type "X". Add it to the ACTIVITY_TYPE master.` (see core/activity/activityTypes.ts).
 * The full `seedMasters` script is also idempotent and would close the gap, but a deploy that runs
 * only "the migrations" must close it too: this migration adds ONLY the ACTIVITY_TYPE codes from
 * the master seed that are missing from the database, in a single targeted pass.
 *
 * Properties:
 *  - narrow: touches ONLY the ACTIVITY_TYPE master, only rows whose `(type, code)` is absent;
 *  - idempotent: missing-row check + `$setOnInsert`; running twice adds nothing the second time;
 *  - safe: never overwrites an existing row's label / colour / active state (administrator edits
 *    to a value are preserved), and re-asserts `systemKey` on existing system rows that lack it,
 *    matching `seedMasters` so a value marked system in the seed becomes a real system value
 *    regardless of how the database was first populated;
 *  - audited: each newly created row is recorded under the system actor, so the change shows up
 *    in the audit history next to anything else a deploy did.
 *
 * Run via `npm run migrate` (added to migrations/index.ts). It is safe on a fresh database too
 * (every code in the seed is present after a normal seed run, so the migration does nothing).
 */
export interface AddedActivityType {
  code: string;
  label: string;
  system: boolean;
}

export async function addMissingActivityTypes(): Promise<AddedActivityType[]> {
  const repo = systemRepo(Master, 'integrity', 'add missing activity types');
  const seedByType = MASTER_SEEDS.filter((s) => s.type === 'ACTIVITY_TYPE');
  if (seedByType.length === 0) return [];

  const expectedCodes = [...new Set(seedByType.map((s) => s.code))];
  const existing = await repo
    .find({ type: 'ACTIVITY_TYPE', branchId: { $exists: false }, code: { $in: expectedCodes } })
    .select('code systemKey')
    .lean<{ code: string; systemKey?: string }[]>();
  const existingByCode = new Map(existing.map((m) => [m.code, m]));

  const added: AddedActivityType[] = [];
  // sortOrder is allocated AFTER existing rows for this type, so inserted rows are appended, not interleaved.
  const existingSort = await repo
    .find({ type: 'ACTIVITY_TYPE', branchId: { $exists: false } })
    .select('sortOrder')
    .lean<{ sortOrder?: number }[]>();
  let nextSort = (existingSort.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0) ?? 0) + 1;

  for (const seed of seedByType) {
    const present = existingByCode.get(seed.code);
    if (present) {
      // Re-assert systemKey on existing system rows the way seedMasters does, so the value is
      // recognised as a system one even if it was created without that flag.
      if (seed.system && !present.systemKey) {
        await repo.updateOne(
          { type: 'ACTIVITY_TYPE', code: seed.code, branchId: { $exists: false } },
          { $set: { systemKey: seed.code } },
          { overwriteImmutable: true },
        );
      }
      continue;
    }
    const doc = await repo.create({
      type: 'ACTIVITY_TYPE',
      code: seed.code,
      label: seed.label,
      description: seed.description,
      color: seed.color,
      sortOrder: nextSort++,
      isActive: true,
      ...(seed.system ? { systemKey: seed.code } : {}),
    });
    added.push({ code: seed.code, label: seed.label, system: Boolean(seed.system) });
    // The migration runs as a deploy job, not as a user. The audit log keeps a record anyway so
    // the change shows up in the master value's history (no userId / no branchId -> system actor).
    await recordAudit({
      entityType: 'master',
      entityId: doc._id,
      action: 'create',
      after: { type: 'ACTIVITY_TYPE', code: seed.code, label: seed.label, system: Boolean(seed.system) },
      reason: 'addMissingActivityTypes: ACTIVITY_TYPE added on a database that was seeded before this code existed',
    });
  }
  return added;
}
