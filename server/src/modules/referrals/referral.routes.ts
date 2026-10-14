import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { idParams, toObjectId } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { identityLimiter } from '../../middleware/identityLimiter';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { Referral } from './referral.model';
import { assignBody, createReferralBody, fromClientBody, fromClientParams, fromUserBody, fromUserParams, linkEnquiryBody, listReferralQuery, unlinkEnquiryBody, unlinkParams, updateReferralBody } from './referral.schema';
import * as svc from './referral.service';

/** A referral's timeline is readable only by someone who can see that referral (branch / assignment scope). */
registerRefAuthorizer('referral', async (principal, id) => Boolean(await scopedRepo(Referral, principal, { includeArchived: true }).exists({ _id: toObjectId(id) })));

export const referralRoutes = Router();

referralRoutes.get('/referrals', authorize('referrals.view'), validate({ query: listReferralQuery }), async (req, res) => {
  const { rows, meta } = await svc.listReferrals(req.principal!, validated<never, never, typeof listReferralQuery>(req).query);
  paginated(res, rows, meta);
});

// The three creation flows. Each decides the referral type itself; the caller never sends one.
referralRoutes.post('/referrals', authorize('referrals.create'), identityLimiter, validate({ body: createReferralBody }), async (req, res) => {
  created(res, await svc.createExternal(req.principal!, validated<typeof createReferralBody>(req).body));
});
referralRoutes.post('/referrals/from-client/:clientId', authorize('referrals.create'), validate({ params: fromClientParams, body: fromClientBody }), async (req, res) => {
  const v = validated<typeof fromClientBody, typeof fromClientParams>(req);
  created(res, await svc.createFromClient(req.principal!, v.params.clientId, v.body));
});
referralRoutes.post('/referrals/from-user/:userId', authorize('referrals.create'), identityLimiter, validate({ params: fromUserParams, body: fromUserBody }), async (req, res) => {
  const v = validated<typeof fromUserBody, typeof fromUserParams>(req);
  created(res, await svc.createFromUser(req.principal!, v.params.userId, v.body));
});

referralRoutes.get('/referrals/:id', authorize('referrals.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getReferral(req.principal!, validated<never, typeof idParams>(req).params.id));
});
referralRoutes.patch('/referrals/:id', authorize('referrals.edit'), validate({ params: idParams, body: updateReferralBody }), async (req, res) => {
  const v = validated<typeof updateReferralBody, typeof idParams>(req);
  ok(res, await svc.updateReferral(req.principal!, v.params.id, v.body));
});
referralRoutes.delete('/referrals/:id', authorize('referrals.archive'), validate({ params: idParams }), async (req, res) => {
  await svc.archiveReferral(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
referralRoutes.post('/referrals/:id/assign', authorize('referrals.assign'), validate({ params: idParams, body: assignBody }), async (req, res) => {
  const v = validated<typeof assignBody, typeof idParams>(req);
  ok(res, await svc.assignReferral(req.principal!, v.params.id, v.body));
});
referralRoutes.post('/referrals/:id/enquiries', authorize('referrals.edit'), validate({ params: idParams, body: linkEnquiryBody }), async (req, res) => {
  const v = validated<typeof linkEnquiryBody, typeof idParams>(req);
  ok(res, await svc.linkEnquiry(req.principal!, v.params.id, v.body.enquiryId));
});
referralRoutes.post('/referrals/:id/enquiries/:enquiryId/unlink', authorize('referrals.edit'), validate({ params: unlinkParams, body: unlinkEnquiryBody }), async (req, res) => {
  const v = validated<typeof unlinkEnquiryBody, typeof unlinkParams>(req);
  ok(res, await svc.unlinkEnquiry(req.principal!, v.params.id, v.params.enquiryId, v.body.reason));
});
