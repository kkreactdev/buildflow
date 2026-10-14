import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { Master } from '../masters/master.model';
import type { VisitStatusKey } from './sitevisit.status';

export interface VisitStatusRef {
  _id: Types.ObjectId;
  label: string;
}

/** Resolves a SITEVISIT_STATUS value by its immutable system key. Statuses are global masters. */
export async function getVisitStatus(key: VisitStatusKey): Promise<VisitStatusRef> {
  const m = await systemRepo(Master, 'integrity', 'site visit status lookup').findOne({ type: 'SITEVISIT_STATUS', systemKey: key }).lean<VisitStatusRef>();
  if (!m) throw new AppError('SITEVISIT_STATUS_NOT_CONFIGURED', 500, `The site visit status ${key} is missing. Run the seed.`);
  return m;
}

/**
 * The FOLLOWUP_TYPE used for the automatic post-visit follow-up: configured by master CODE
 * (POST_VISIT_FOLLOWUP_TYPE_CODE), never hard-coded. Missing or deactivated is a configuration error that
 * is reported before anything is written, so a completion never half-succeeds or silently skips the follow-up.
 */
export async function getPostVisitFollowUpType(code: string): Promise<{ _id: Types.ObjectId; label: string }> {
  const m = await systemRepo(Master, 'integrity', 'post-visit follow-up type').findOne({ type: 'FOLLOWUP_TYPE', code, isActive: true }).lean<{ _id: Types.ObjectId; label: string }>();
  if (!m) throw new AppError('POST_VISIT_FOLLOWUP_NOT_CONFIGURED', 500, `The follow-up type "${code}" used after site visits is missing or inactive. Add or activate it in Masters, or change POST_VISIT_FOLLOWUP_TYPE_CODE.`);
  return m;
}
