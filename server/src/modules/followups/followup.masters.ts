import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { Master } from '../masters/master.model';
import type { FollowUpStatusKey } from './followup.status';

export interface StatusRef {
  _id: import('mongoose').Types.ObjectId;
  label: string;
}

/**
 * Resolves a FOLLOWUP_STATUS value by its immutable system key. Statuses are global masters, so any
 * caller (a request or a job) may resolve them; the keys cannot be removed or re-keyed by administrators.
 */
export async function getStatusMaster(key: FollowUpStatusKey): Promise<StatusRef> {
  const m = await systemRepo(Master, 'integrity', 'follow-up status lookup').findOne({ type: 'FOLLOWUP_STATUS', systemKey: key }).lean<{ _id: StatusRef['_id']; label: string }>();
  if (!m) throw new AppError('FOLLOWUP_STATUS_NOT_CONFIGURED', 500, `The follow-up status ${key} is missing. Run the seed.`);
  return { _id: m._id, label: m.label };
}
