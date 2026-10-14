import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { Master } from '../masters/master.model';

export interface UnitStatusRef {
  _id: Types.ObjectId;
  label: string;
  systemKey: string;
}

/** Resolves a UNIT_STATUS value by its immutable system key. Statuses are global masters. */
export async function getUnitStatusByKey(key: string): Promise<UnitStatusRef> {
  const m = await systemRepo(Master, 'integrity', 'unit status lookup').findOne({ type: 'UNIT_STATUS', systemKey: key }).lean<UnitStatusRef>();
  if (!m) throw new AppError('UNIT_STATUS_NOT_CONFIGURED', 500, `The unit status ${key} is missing. Run the seed.`);
  return m;
}

/** The stable key stored with a unit's status: the master's system key, else its code (for statuses admins add later). */
export async function statusKeyOf(id: Types.ObjectId): Promise<string> {
  const m = await systemRepo(Master, 'integrity', 'unit status key').findOne({ _id: id, type: 'UNIT_STATUS' }).lean<{ systemKey?: string; code: string }>();
  if (!m) throw new AppError('UNIT_STATUS_NOT_CONFIGURED', 500, 'The unit status could not be resolved');
  return m.systemKey ?? m.code;
}
