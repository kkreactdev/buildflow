import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { idParams, toObjectId } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { FollowUp } from './followup.model';
import { cancelBody, completeBody, createFollowUpBody, listFollowUpQuery, rescheduleBody, summaryQuery, updateFollowUpBody } from './followup.schema';
import * as svc from './followup.service';

/** A follow-up's own timeline is readable only by someone who can see that follow-up. */
registerRefAuthorizer('followup', async (principal, id) => Boolean(await scopedRepo(FollowUp, principal, { includeArchived: true }).exists({ _id: toObjectId(id) })));

export const followUpRoutes = Router();

// Fixed paths before `/:id`.
followUpRoutes.get('/followups/summary', authorize('followups.view'), validate({ query: summaryQuery }), async (req, res) => {
  ok(res, await svc.summary(req.principal!, validated<never, never, typeof summaryQuery>(req).query));
});
followUpRoutes.get('/followups', authorize('followups.view'), validate({ query: listFollowUpQuery }), async (req, res) => {
  const { rows, meta } = await svc.listFollowUps(req.principal!, validated<never, never, typeof listFollowUpQuery>(req).query);
  paginated(res, rows, meta);
});
followUpRoutes.post('/followups', authorize('followups.create'), validate({ body: createFollowUpBody }), async (req, res) => {
  created(res, await svc.createFollowUp(req.principal!, validated<typeof createFollowUpBody>(req).body));
});
followUpRoutes.get('/followups/:id', authorize('followups.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getFollowUp(req.principal!, validated<never, typeof idParams>(req).params.id));
});
followUpRoutes.patch('/followups/:id', authorize('followups.edit'), validate({ params: idParams, body: updateFollowUpBody }), async (req, res) => {
  const v = validated<typeof updateFollowUpBody, typeof idParams>(req);
  ok(res, await svc.updateFollowUp(req.principal!, v.params.id, v.body));
});
followUpRoutes.post('/followups/:id/complete', authorize('followups.edit'), validate({ params: idParams, body: completeBody }), async (req, res) => {
  const v = validated<typeof completeBody, typeof idParams>(req);
  ok(res, await svc.completeFollowUp(req.principal!, v.params.id, v.body));
});
followUpRoutes.post('/followups/:id/reschedule', authorize('followups.edit'), validate({ params: idParams, body: rescheduleBody }), async (req, res) => {
  const v = validated<typeof rescheduleBody, typeof idParams>(req);
  ok(res, await svc.rescheduleFollowUp(req.principal!, v.params.id, v.body));
});
followUpRoutes.post('/followups/:id/cancel', authorize('followups.edit'), validate({ params: idParams, body: cancelBody }), async (req, res) => {
  const v = validated<typeof cancelBody, typeof idParams>(req);
  ok(res, await svc.cancelFollowUp(req.principal!, v.params.id, v.body));
});
followUpRoutes.delete('/followups/:id', authorize('followups.archive'), validate({ params: idParams }), async (req, res) => {
  await svc.archiveFollowUp(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
