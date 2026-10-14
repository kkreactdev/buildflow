import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { createRoleBody, listRoleQuery, updateRoleBody } from './role.schema';
import * as svc from './role.service';

export const roleRoutes = Router();

roleRoutes.get('/roles', authorize('roles.view'), validate({ query: listRoleQuery }), async (req, res) => {
  const { rows, meta } = await svc.listRoles(validated<never, never, typeof listRoleQuery>(req).query);
  paginated(res, rows, meta);
});
roleRoutes.get('/roles/:id', authorize('roles.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getRole(validated<never, typeof idParams>(req).params.id));
});
roleRoutes.post('/roles', authorize('roles.manage'), validate({ body: createRoleBody }), async (req, res) => {
  created(res, await svc.createRole(req.principal!, validated<typeof createRoleBody>(req).body));
});
roleRoutes.patch('/roles/:id', authorize('roles.manage'), validate({ params: idParams, body: updateRoleBody }), async (req, res) => {
  const v = validated<typeof updateRoleBody, typeof idParams>(req);
  ok(res, await svc.updateRole(req.principal!, v.params.id, v.body));
});
roleRoutes.delete('/roles/:id', authorize('roles.manage'), validate({ params: idParams }), async (req, res) => {
  await svc.deleteRole(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
