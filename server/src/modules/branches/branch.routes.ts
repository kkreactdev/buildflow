import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { createBranchBody, listBranchQuery, updateBranchBody } from './branch.schema';
import * as svc from './branch.service';

export const branchRoutes = Router();

branchRoutes.get('/branches', authorize('branches.view'), validate({ query: listBranchQuery }), async (req, res) => {
  const { rows, meta } = await svc.listBranches(req.principal!, validated<never, never, typeof listBranchQuery>(req).query);
  paginated(res, rows, meta);
});
branchRoutes.get('/branches/:id', authorize('branches.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getBranch(req.principal!, validated<never, typeof idParams>(req).params.id));
});
branchRoutes.post('/branches', authorize('branches.manage'), validate({ body: createBranchBody }), async (req, res) => {
  created(res, await svc.createBranch(req.principal!, validated<typeof createBranchBody>(req).body));
});
branchRoutes.patch('/branches/:id', authorize('branches.manage'), validate({ params: idParams, body: updateBranchBody }), async (req, res) => {
  const v = validated<typeof updateBranchBody, typeof idParams>(req);
  ok(res, await svc.updateBranch(req.principal!, v.params.id, v.body));
});
