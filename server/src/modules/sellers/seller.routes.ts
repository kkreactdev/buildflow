import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { idParams, toObjectId } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { identityLimiter } from '../../middleware/identityLimiter';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { Seller, SellerProperty } from './seller.model';
import {
  addPropertyBody,
  approveBody,
  assignBody,
  createSellerBody,
  listPropertyQuery,
  listSellerQuery,
  negotiationBody,
  purchaseBody,
  readyToSellBody,
  rejectBody,
  refurbishBody,
  sellerStatusBody,
  updatePropertyBody,
  updateSellerBody,
  verificationBody,
  withdrawBody,
} from './seller.schema';
import * as svc from './seller.service';

/** A seller's timeline is readable only by someone who can see that seller (branch / assignment scope). */
registerRefAuthorizer('seller', async (principal, id) => Boolean(await scopedRepo(Seller, principal, { includeArchived: true }).exists({ _id: toObjectId(id) })));
registerRefAuthorizer('sellerProperty', async (principal, id) => Boolean(await scopedRepo(SellerProperty, principal, { includeArchived: true }).exists({ _id: toObjectId(id) })));

export const sellerRoutes = Router();

// Fixed paths before `/sellers/:id`, so "properties" is never read as a seller id.
/** The property pipeline across every seller the caller may see. */
sellerRoutes.get('/sellers/properties', authorize('sellers.view'), validate({ query: listPropertyQuery }), async (req, res) => {
  const { rows, meta } = await svc.listProperties(req.principal!, validated<never, never, typeof listPropertyQuery>(req).query);
  paginated(res, rows, meta);
});

sellerRoutes.get('/sellers', authorize('sellers.view'), validate({ query: listSellerQuery }), async (req, res) => {
  const { rows, meta } = await svc.listSellers(req.principal!, validated<never, never, typeof listSellerQuery>(req).query);
  paginated(res, rows, meta);
});

/** Seller and first proposed property in one call. */
sellerRoutes.post('/sellers', authorize('sellers.create'), identityLimiter, validate({ body: createSellerBody }), async (req, res) => {
  created(res, await svc.createSeller(req.principal!, validated<typeof createSellerBody>(req).body));
});

sellerRoutes.get('/sellers/:id', authorize('sellers.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getSeller(req.principal!, validated<never, typeof idParams>(req).params.id));
});
sellerRoutes.patch('/sellers/:id', authorize('sellers.edit'), validate({ params: idParams, body: updateSellerBody }), async (req, res) => {
  const v = validated<typeof updateSellerBody, typeof idParams>(req);
  ok(res, await svc.updateSeller(req.principal!, v.params.id, v.body));
});
sellerRoutes.delete('/sellers/:id', authorize('sellers.archive'), validate({ params: idParams }), async (req, res) => {
  await svc.archiveSeller(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
sellerRoutes.post('/sellers/:id/assign', authorize('sellers.assign'), validate({ params: idParams, body: assignBody }), async (req, res) => {
  const v = validated<typeof assignBody, typeof idParams>(req);
  ok(res, await svc.assignSeller(req.principal!, v.params.id, v.body));
});
/** Seller relationship status by target (VERIFIED needs sellers.verify too, checked in the service). */
sellerRoutes.post('/sellers/:id/status', authorize('sellers.edit'), validate({ params: idParams, body: sellerStatusBody }), async (req, res) => {
  const v = validated<typeof sellerStatusBody, typeof idParams>(req);
  ok(res, await svc.changeSellerStatus(req.principal!, v.params.id, v.body));
});

// ---- proposed properties ------------------------------------------------------

sellerRoutes.get('/seller-properties/:id', authorize('sellers.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getProperty(req.principal!, validated<never, typeof idParams>(req).params.id));
});

sellerRoutes.post('/sellers/:id/properties', authorize('sellers.create'), validate({ params: idParams, body: addPropertyBody }), async (req, res) => {
  const v = validated<typeof addPropertyBody, typeof idParams>(req);
  created(res, await svc.addProperty(req.principal!, v.params.id, v.body));
});
sellerRoutes.patch('/seller-properties/:id', authorize('sellers.edit'), validate({ params: idParams, body: updatePropertyBody }), async (req, res) => {
  const v = validated<typeof updatePropertyBody, typeof idParams>(req);
  ok(res, await svc.updateProperty(req.principal!, v.params.id, v.body));
});

/** Verification checklist + outcome. */
sellerRoutes.post('/seller-properties/:id/verify', authorize('sellers.verify'), validate({ params: idParams, body: verificationBody }), async (req, res) => {
  const v = validated<typeof verificationBody, typeof idParams>(req);
  ok(res, await svc.verifyProperty(req.principal!, v.params.id, v.body));
});
/** One negotiation round (asking / offered / counter / outcome). */
sellerRoutes.post('/seller-properties/:id/negotiations', authorize('sellers.edit'), validate({ params: idParams, body: negotiationBody }), async (req, res) => {
  const v = validated<typeof negotiationBody, typeof idParams>(req);
  created(res, await svc.recordNegotiation(req.principal!, v.params.id, v.body));
});
sellerRoutes.post('/seller-properties/:id/approve', authorize('sellers.approve'), validate({ params: idParams, body: approveBody }), async (req, res) => {
  const v = validated<typeof approveBody, typeof idParams>(req);
  ok(res, await svc.approveProperty(req.principal!, v.params.id, v.body));
});
/** Purchase completion: records the deal and creates exactly one Unit. Idempotent. */
sellerRoutes.post('/seller-properties/:id/purchase', authorize('sellers.purchase'), validate({ params: idParams, body: purchaseBody }), async (req, res) => {
  const v = validated<typeof purchaseBody, typeof idParams>(req);
  ok(res, await svc.completePurchase(req.principal!, v.params.id, v.body));
});
/** Refurbishment / development tracking. */
sellerRoutes.post('/seller-properties/:id/refurbish', authorize('sellers.refurbish'), validate({ params: idParams, body: refurbishBody }), async (req, res) => {
  const v = validated<typeof refurbishBody, typeof idParams>(req);
  ok(res, await svc.recordWork(req.principal!, v.params.id, v.body));
});
/** Release to buyers. Requires purchase + development; respects unit availability. */
sellerRoutes.post('/seller-properties/:id/ready-to-sell', authorize('sellers.release'), validate({ params: idParams, body: readyToSellBody }), async (req, res) => {
  const v = validated<typeof readyToSellBody, typeof idParams>(req);
  ok(res, await svc.markReadyToSell(req.principal!, v.params.id, v.body));
});
/** The company declines the proposal (reversing an approval also needs sellers.approve, checked in the service). */
sellerRoutes.post('/seller-properties/:id/reject', authorize('sellers.edit'), validate({ params: idParams, body: rejectBody }), async (req, res) => {
  const v = validated<typeof rejectBody, typeof idParams>(req);
  ok(res, await svc.rejectProperty(req.principal!, v.params.id, v.body));
});
/** The seller takes the offer back. */
sellerRoutes.post('/seller-properties/:id/withdraw', authorize('sellers.edit'), validate({ params: idParams, body: withdrawBody }), async (req, res) => {
  const v = validated<typeof withdrawBody, typeof idParams>(req);
  ok(res, await svc.withdrawProperty(req.principal!, v.params.id, v.body));
});