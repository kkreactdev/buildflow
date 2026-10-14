import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { idParams, toObjectId } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { identityLimiter } from '../../middleware/identityLimiter';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { Enquiry } from './enquiry.model';
import { assignBody, convertBody, boardQuery, createEnquiryBody, exportQuery, listEnquiryQuery, loseBody, reopenBody, transitionBody, updateEnquiryBody } from './enquiry.schema';
import * as svc from './enquiry.service';

/** An enquiry's timeline is readable only by someone who can see that enquiry (branch / assignment scope). */
registerRefAuthorizer('enquiry', async (principal, id) => Boolean(await scopedRepo(Enquiry, principal, { includeArchived: true }).exists({ _id: toObjectId(id) })));

export const enquiryRoutes = Router();

// Fixed paths first so they are never read as `/:id`.
enquiryRoutes.get('/enquiries/export.csv', authorize('enquiries.export'), validate({ query: exportQuery }), async (req, res) => {
  // Headers go out with the first chunk, AFTER the size check, so a refusal is still a normal JSON error.
  let started = false;
  await svc.exportEnquiries(req.principal!, validated<never, never, typeof exportQuery>(req).query, (chunk) => {
    if (!started) {
      started = true;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="enquiries.csv"');
    }
    res.write(chunk);
  });
  res.end();
});
enquiryRoutes.get('/enquiries/board', authorize('enquiries.view'), validate({ query: boardQuery }), async (req, res) => {
  ok(res, await svc.board(req.principal!, validated<never, never, typeof boardQuery>(req).query));
});

enquiryRoutes.get('/enquiries', authorize('enquiries.view'), validate({ query: listEnquiryQuery }), async (req, res) => {
  const { rows, meta } = await svc.listEnquiries(req.principal!, validated<never, never, typeof listEnquiryQuery>(req).query);
  paginated(res, rows, meta);
});
enquiryRoutes.post('/enquiries', authorize('enquiries.create'), identityLimiter, validate({ body: createEnquiryBody }), async (req, res) => {
  created(res, await svc.createEnquiry(req.principal!, validated<typeof createEnquiryBody>(req).body));
});
enquiryRoutes.get('/enquiries/:id', authorize('enquiries.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getEnquiry(req.principal!, validated<never, typeof idParams>(req).params.id));
});
enquiryRoutes.patch('/enquiries/:id', authorize('enquiries.edit'), validate({ params: idParams, body: updateEnquiryBody }), async (req, res) => {
  const v = validated<typeof updateEnquiryBody, typeof idParams>(req);
  ok(res, await svc.updateEnquiry(req.principal!, v.params.id, v.body));
});
enquiryRoutes.delete('/enquiries/:id', authorize('enquiries.archive'), validate({ params: idParams }), async (req, res) => {
  await svc.archiveEnquiry(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
enquiryRoutes.post('/enquiries/:id/assign', authorize('enquiries.assign'), validate({ params: idParams, body: assignBody }), async (req, res) => {
  const v = validated<typeof assignBody, typeof idParams>(req);
  ok(res, await svc.assignEnquiry(req.principal!, v.params.id, v.body));
});

/**
 * The single stage-change endpoint. Which permission applies depends on the direction (forward needs
 * enquiries.edit, backward enquiries.revert, lost enquiries.lose, reopen enquiries.reopen), and that
 * is decided by the workflow state machine, not by this route.
 */
enquiryRoutes.post('/enquiries/:id/transition', authorize('enquiries.view'), validate({ params: idParams, body: transitionBody }), async (req, res) => {
  const v = validated<typeof transitionBody, typeof idParams>(req);
  ok(res, await svc.transitionEnquiry(req.principal!, v.params.id, v.body));
});
enquiryRoutes.post('/enquiries/:id/convert', authorize('enquiries.convert'), validate({ params: idParams, body: convertBody }), async (req, res) => {
  const v = validated<typeof convertBody, typeof idParams>(req);
  ok(res, await svc.convertEnquiry(req.principal!, v.params.id, v.body));
});
enquiryRoutes.post('/enquiries/:id/lose', authorize('enquiries.lose'), validate({ params: idParams, body: loseBody }), async (req, res) => {
  const v = validated<typeof loseBody, typeof idParams>(req);
  ok(res, await svc.transitionEnquiry(req.principal!, v.params.id, { to: 'LOST', from: v.body.from, lostReasonId: v.body.lostReasonId, reason: v.body.note }, { direction: 'LOST' }));
});
enquiryRoutes.post('/enquiries/:id/reopen', authorize('enquiries.reopen'), validate({ params: idParams, body: reopenBody }), async (req, res) => {
  const v = validated<typeof reopenBody, typeof idParams>(req);
  ok(res, await svc.transitionEnquiry(req.principal!, v.params.id, v.body, { direction: 'REOPEN' }));
});
