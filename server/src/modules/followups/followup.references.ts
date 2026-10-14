import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { registerMasterReference } from '../masters/references';
import { FollowUp } from './followup.model';

/** A follow-up type or status that any follow-up (any branch, archived included) points at cannot be deleted. */
const inUse = (field: 'typeId' | 'statusId') => async (id: Types.ObjectId) => Boolean(await systemRepo(FollowUp, 'integrity', `follow-up ${field} in-use check`).exists({ [field]: id }));

registerMasterReference('FOLLOWUP_TYPE', inUse('typeId'));
registerMasterReference('FOLLOWUP_STATUS', inUse('statusId'));
