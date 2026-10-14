import type { Types } from 'mongoose';
import { registerMasterReference } from '../masters/references';
import { WhatsAppTemplate } from './whatsappTemplate.model';

/** A category or event used by ANY template (archived included) cannot be hard-deleted; a deactivated one keeps displaying on the template. */
registerMasterReference('WA_CATEGORY', async (id: Types.ObjectId) => Boolean(await WhatsAppTemplate.exists({ categoryId: id })));
registerMasterReference('WA_EVENT', async (id: Types.ObjectId) => Boolean(await WhatsAppTemplate.exists({ eventId: id })));
