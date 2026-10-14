import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { identityLimiter } from '../../middleware/identityLimiter';
import { idParams } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { scopedRepo } from '../../core/scope';
import { toObjectId } from '../../lib/ids';
import { createClientBody, listClientQuery, updateClientBody } from './client.schema';
import { Client } from './client.model';
import { getClientLinkedUnits, getClientRelated } from './client.related';
import * as svc from './client.service';

/** A client's timeline is only readable by someone who can see that client (their branch / assignment). */
registerRefAuthorizer('client', async (principal, id) => Boolean(await scopedRepo(Client, principal, { includeArchived: true }).exists({ _id: toObjectId(id) })));

export const clientRoutes = Router();

clientRoutes.get('/clients', authorize('clients.view'), validate({ query: listClientQuery }), async (req, res) => {
  const { rows, meta } = await svc.listClients(req.principal!, validated<never, never, typeof listClientQuery>(req).query);
  paginated(res, rows, meta);
});
clientRoutes.get('/clients/:id', authorize('clients.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getClient(req.principal!, validated<never, typeof idParams>(req).params.id));
});
/** Enquiries, follow-ups, site visits, bookings and units connected to this client (see client.related.ts for the one resolution rule). */
clientRoutes.get('/clients/:id/related', authorize('clients.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await getClientRelated(req.principal!, validated<never, typeof idParams>(req).params.id));
});
/** Picker: the units linked to this client across ALL of its enquiries, one row per unit. null = no permission to view units. */
clientRoutes.get('/clients/:id/units', authorize('clients.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await getClientLinkedUnits(req.principal!, validated<never, typeof idParams>(req).params.id));
});
clientRoutes.post('/clients', authorize('clients.create'), identityLimiter, validate({ body: createClientBody }), async (req, res) => {
  created(res, await svc.createClient(req.principal!, validated<typeof createClientBody>(req).body));
});
clientRoutes.patch('/clients/:id', authorize('clients.edit'), validate({ params: idParams, body: updateClientBody }), async (req, res) => {
  const v = validated<typeof updateClientBody, typeof idParams>(req);
  ok(res, await svc.updateClient(req.principal!, v.params.id, v.body));
});
clientRoutes.delete('/clients/:id', authorize('clients.archive'), validate({ params: idParams }), async (req, res) => {
  await svc.archiveClient(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
