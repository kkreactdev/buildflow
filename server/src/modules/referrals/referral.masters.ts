import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { Master } from '../masters/master.model';
import type { ReferralTypeKey } from './referral.types';

/** Resolves a REFERRAL_TYPE value by its immutable system key. Referral types are global masters. */
export async function getReferralType(key: ReferralTypeKey): Promise<{ _id: Types.ObjectId; label: string }> {
  const m = await systemRepo(Master, 'integrity', 'referral type lookup').findOne({ type: 'REFERRAL_TYPE', systemKey: key }).lean<{ _id: Types.ObjectId; label: string }>();
  if (!m) throw new AppError('REFERRAL_TYPE_NOT_CONFIGURED', 500, `The referral type ${key} is missing. Run the seed.`);
  return m;
}
