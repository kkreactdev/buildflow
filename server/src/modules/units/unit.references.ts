import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { registerMasterReference } from '../masters/references';
import { Unit } from './unit.model';

/**
 * A master value used by ANY unit (any branch, archived included) cannot be hard-deleted; it can only be
 * deactivated, and units keep showing it. Media type lives inside the media array.
 */
const inUse = (field: string) => async (id: Types.ObjectId) => Boolean(await systemRepo(Unit, 'integrity', `unit ${field} in-use check`).exists({ [field]: id }));

registerMasterReference('PROPERTY_TYPE', inUse('propertyTypeId'));
registerMasterReference('BUILDING_TYPE', inUse('buildingTypeId'));
registerMasterReference('LOCATION', inUse('locationId'));
registerMasterReference('UNIT_STATUS', inUse('statusId'));
registerMasterReference('MEDIA_TYPE', inUse('media.typeId'));
