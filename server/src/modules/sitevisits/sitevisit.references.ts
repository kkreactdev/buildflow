import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { registerMasterReference } from '../masters/references';
import { SiteVisit } from './sitevisit.model';

/** A visit status used by any visit (any branch, archived included) is tracked as referenced. */
registerMasterReference('SITEVISIT_STATUS', async (id: Types.ObjectId) => Boolean(await systemRepo(SiteVisit, 'integrity', 'site visit status in-use check').exists({ statusId: id })));
