import { systemRepo } from '../core/scope/system';
import { Master } from '../modules/masters/master.model';
import { getMasterType } from '../modules/masters/masterTypes';
import { MASTER_SEEDS } from './masterSeed';

export interface SeedMastersResult {
  created: number;
  existing: number;
}

/**
 * Idempotent. A value is identified by (type, code) among global values and is
 * only INSERTED when missing, so edits made by administrators (labels, colours,
 * ordering, deactivation of non-system values) survive every re-run. System
 * values additionally have their `systemKey` re-asserted.
 */
export async function seedMasters(): Promise<SeedMastersResult> {
  const repo = systemRepo(Master, 'seed', 'master values');
  const result: SeedMastersResult = { created: 0, existing: 0 };
  const perType = new Map<string, number>();

  for (const seed of MASTER_SEEDS) {
    const def = getMasterType(seed.type);
    if (!def || def.scope !== 'GLOBAL') throw new Error(`Master seed for "${seed.type}" must be a known GLOBAL type`);
    const order = (perType.get(seed.type) ?? 0) + 1;
    perType.set(seed.type, order);

    const res = await repo.updateOne(
      { type: seed.type, code: seed.code, branchId: { $exists: false } },
      {
        $setOnInsert: {
          type: seed.type, code: seed.code, label: seed.label, description: seed.description, color: seed.color,
          sortOrder: order, isActive: true, ...(seed.system ? { systemKey: seed.code } : {}),
        },
      },
      { upsert: true, overwriteImmutable: true },
    );
    if (res.upsertedCount) result.created++;
    else {
      result.existing++;
      if (seed.system) await repo.updateOne({ type: seed.type, code: seed.code, branchId: { $exists: false }, systemKey: { $exists: false } }, { $set: { systemKey: seed.code } }, { overwriteImmutable: true });
    }
  }
  return result;
}
