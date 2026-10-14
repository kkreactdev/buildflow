import type { ClientSession, Types } from 'mongoose';
import { logger } from '../../lib/logger';
import { systemRepo } from '../scope/system';
import { Activity, type ActivityRefType } from './activity.model';
import { assertActivityType } from './activityTypes';

export interface ActivityRef {
  type: ActivityRefType;
  id: string | Types.ObjectId;
}

export interface RecordActivityInput {
  type: string;
  description: string;
  userId?: string | Types.ObjectId;
  /** Required: the branch where the event happened (taken from the already-scoped entity, never from the request). */
  branchId: string | Types.ObjectId;
  refs: ActivityRef[];
  at?: Date;
  metadata?: Record<string, unknown>;
}

export interface RecordOptions {
  /** Pass the active transaction session so the entry commits/rolls back with the business change. */
  session?: ClientSession;
  /** Swallow + log failures. Use only OUTSIDE a transaction; inside one, let it throw and roll back. */
  bestEffort?: boolean;
}

/**
 * Records one business event on the timeline of every referenced entity,
 * e.g. "Raj Kumar visited Villa 03" -> refs [client, enquiry, sitevisit, unit].
 */
export async function recordActivity(input: RecordActivityInput, opts: RecordOptions = {}): Promise<void> {
  try {
    await assertActivityType(input.type);
    await systemRepo(Activity, 'event', 'activity append').create({ ...input }, { session: opts.session });
  } catch (err) {
    if (!opts.bestEffort) throw err;
    logger.error({ err, type: input.type }, 'Failed to record activity (best effort)');
  }
}
