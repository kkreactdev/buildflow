import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { idParams, toObjectId } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { SiteVisit } from './sitevisit.model';
import { assignBody, cancelBody, completeBody, createVisitBody, listVisitQuery, updateVisitBody } from './sitevisit.schema';
import * as svc from './sitevisit.service';

/** A visit's timeline is readable only by someone who can see that visit (branch / assignment scope). */
registerRefAuthorizer('sitevisit', async (principal, id) => Boolean(await scopedRepo(SiteVisit, principal, { includeArchived: true }).exists({ _id: toObjectId(id) })));

export const siteVisitRoutes = Router();

siteVisitRoutes.get('/sitevisits', authorize('sitevisits.view'), validate({ query: listVisitQuery }), async (req, res) => {
  const { rows, meta } = await svc.listVisits(req.principal!, validated<never, never, typeof listVisitQuery>(req).query);
  paginated(res, rows, meta);
});
siteVisitRoutes.post('/sitevisits', authorize('sitevisits.create'), validate({ body: createVisitBody }), async (req, res) => {
  created(res, await svc.createVisit(req.principal!, validated<typeof createVisitBody>(req).body));
});
siteVisitRoutes.get('/sitevisits/:id', authorize('sitevisits.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getVisit(req.principal!, validated<never, typeof idParams>(req).params.id));
});
siteVisitRoutes.patch('/sitevisits/:id', authorize('sitevisits.edit'), validate({ params: idParams, body: updateVisitBody }), async (req, res) => {
  const v = validated<typeof updateVisitBody, typeof idParams>(req);
  ok(res, await svc.updateVisit(req.principal!, v.params.id, v.body));
});
siteVisitRoutes.delete('/sitevisits/:id', authorize('sitevisits.archive'), validate({ params: idParams }), async (req, res) => {
  await svc.archiveVisit(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});

// Lifecycle operations. There is deliberately no generic "set status" route.
siteVisitRoutes.post('/sitevisits/:id/assign', authorize('sitevisits.assign'), validate({ params: idParams, body: assignBody }), async (req, res) => {
  const v = validated<typeof assignBody, typeof idParams>(req);
  ok(res, await svc.assignVisit(req.principal!, v.params.id, v.body));
});
siteVisitRoutes.post('/sitevisits/:id/complete', authorize('sitevisits.complete'), validate({ params: idParams, body: completeBody }), async (req, res) => {
  const v = validated<typeof completeBody, typeof idParams>(req);
  ok(res, await svc.completeVisit(req.principal!, v.params.id, v.body));
});
siteVisitRoutes.post('/sitevisits/:id/cancel', authorize('sitevisits.cancel'), validate({ params: idParams, body: cancelBody }), async (req, res) => {
  const v = validated<typeof cancelBody, typeof idParams>(req);
  ok(res, await svc.cancelVisit(req.principal!, v.params.id, v.body));
});
