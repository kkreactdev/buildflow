import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { registerMasterReference } from '../masters/references';
import { Referral } from './referral.model';

/** A referral type used by ANY referral (any branch, archived included) is tracked as referenced. */
registerMasterReference('REFERRAL_TYPE', async (id: Types.ObjectId) => Boolean(await systemRepo(Referral, 'integrity', 'referral type in-use check').exists({ typeId: id })));
