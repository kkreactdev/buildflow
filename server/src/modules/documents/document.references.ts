import type { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { registerMasterReference } from '../masters/references';
import { DocumentRecord } from './document.model';

/** A document type used by ANY document (any branch, archived included) cannot be hard-deleted; a deactivated one keeps displaying. */
registerMasterReference('DOCUMENT_TYPE', async (id: Types.ObjectId) => Boolean(await systemRepo(DocumentRecord, 'integrity', 'document type in-use check').exists({ documentTypeId: id })));
