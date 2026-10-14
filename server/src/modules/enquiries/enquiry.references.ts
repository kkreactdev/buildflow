import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { registerMasterReference } from '../masters/references';
import { Enquiry, EnquiryStageHistory } from './enquiry.model';

/**
 * An enquiry stores ids of these master types, so a value can only be hard-deleted when no enquiry
 * uses it, in ANY branch and including archived enquiries (hence the integrity scope). A lost reason is
 * also kept in the stage history after a reopen, so the history counts too.
 */
const inUse = (field: string) => async (id: Types.ObjectId) => Boolean(await systemRepo(Enquiry, 'integrity', `${field} in-use check`).exists({ [field]: id }));

registerMasterReference('ENQUIRY_SOURCE', inUse('sourceId'));
registerMasterReference('ENQUIRY_TYPE', inUse('typeId'));
registerMasterReference('PROPERTY_TYPE', inUse('propertyTypeId'));
registerMasterReference('BUILDING_TYPE', inUse('buildingTypeId'));
registerMasterReference('LOCATION', inUse('locationId'));
registerMasterReference('LOST_REASON', async (id) =>
  (await inUse('lostReasonId')(id)) || Boolean(await systemRepo(EnquiryStageHistory, 'integrity', 'lost reason history check').exists({ lostReasonId: id })),
);
