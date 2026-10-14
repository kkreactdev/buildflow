import { systemRepo } from '../scope/system';
import { Master } from '../../modules/masters/master.model';
import { AppError } from '../../lib/appError';

const known = new Set<string>();

/**
 * Activity types are a master (ACTIVITY_TYPE). Recording an activity with a
 * code that is not a configured type is a programming error, so it is refused.
 * Only existence is checked (not active state): a business event must still be
 * recorded even if an admin later deactivates its type.
 */
export async function assertActivityType(code: string): Promise<void> {
  if (known.has(code)) return;
  const found = await systemRepo(Master, 'integrity', 'activity type check').exists({ type: 'ACTIVITY_TYPE', code });
  if (!found) throw new AppError('UNKNOWN_ACTIVITY_TYPE', 500, `Unknown activity type "${code}". Add it to the ACTIVITY_TYPE master (seeded types live in seeds/masterSeed.ts).`);
  known.add(code);
}

/** Test helper: forget cached lookups. */
export const resetActivityTypeCache = (): void => known.clear();
