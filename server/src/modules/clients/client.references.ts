import { Types } from 'mongoose';
import { systemRepo } from '../../core/scope/system';
import { registerMasterReference } from '../masters/references';
import { Client } from './client.model';

/**
 * A client category may only be hard-deleted if no client uses it, in ANY
 * branch and including archived clients, so the check needs the integrity scope.
 */
registerMasterReference('CLIENT_CATEGORY', async (id: Types.ObjectId) =>
  Boolean(await systemRepo(Client, 'integrity', 'client category in-use check').exists({ categoryId: id })),
);
