import { Router, type NextFunction, type Request, type Response } from 'express';
import { authorize, markGuard } from '../../core/permissions/principal';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { createMasterBody, groupedQuery, listMasterQuery, reorderBody, typeIdParams, typeParams, updateMasterBody } from './master.schema';
import * as svc from './master.service';

export const masterRoutes = Router();

/**
 * Route guard for writes, placed BEFORE validation so anonymous callers get 401 and under-privileged
 * callers 403 without learning anything about the payload rules. The required permission (and scope)
 * depends on the master type, so it is resolved from `:type`.
 */
const authorizeManage = markGuard((req: Request, _res: Response, next: NextFunction) => {
  try {
    svc.assertCanManage(req.principal, svc.typeDef(String(req.params.type)));
    next();
  } catch (err) {
    next(err);
  }
});

masterRoutes.get('/masters/types', authorize('masters.view'), (_req, res) => ok(res, svc.listTypes()));

masterRoutes.get('/masters', authorize('masters.view'), validate({ query: groupedQuery }), async (req, res) => {
  ok(res, await svc.groupedMasters(req.principal!, validated<never, never, typeof groupedQuery>(req).query));
});

masterRoutes.get('/masters/:type', authorize('masters.view'), validate({ params: typeParams, query: listMasterQuery }), async (req, res) => {
  const v = validated<never, typeof typeParams, typeof listMasterQuery>(req);
  const { rows, meta } = await svc.listMasters(req.principal!, v.params.type, v.query);
  paginated(res, rows, meta);
});

masterRoutes.get('/masters/:type/:id', authorize('masters.view'), validate({ params: typeIdParams }), async (req, res) => {
  const { type, id } = validated<never, typeof typeIdParams>(req).params;
  ok(res, await svc.getMaster(req.principal!, type, id));
});

masterRoutes.post('/masters/:type', authorizeManage, validate({ params: typeParams, body: createMasterBody }), async (req, res) => {
  const v = validated<typeof createMasterBody, typeof typeParams>(req);
  created(res, await svc.createMaster(req.principal!, v.params.type, v.body));
});

masterRoutes.post('/masters/:type/reorder', authorizeManage, validate({ params: typeParams, body: reorderBody }), async (req, res) => {
  const v = validated<typeof reorderBody, typeof typeParams>(req);
  ok(res, await svc.reorderMasters(req.principal!, v.params.type, v.body));
});

masterRoutes.patch('/masters/:type/:id', authorizeManage, validate({ params: typeIdParams, body: updateMasterBody }), async (req, res) => {
  const v = validated<typeof updateMasterBody, typeof typeIdParams>(req);
  ok(res, await svc.updateMaster(req.principal!, v.params.type, v.params.id, v.body));
});

masterRoutes.delete('/masters/:type/:id', authorizeManage, validate({ params: typeIdParams }), async (req, res) => {
  const { type, id } = validated<never, typeof typeIdParams>(req).params;
  await svc.deleteMaster(req.principal!, type, id);
  res.status(204).end();
});
