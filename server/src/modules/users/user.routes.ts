import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { createUserBody, listUserQuery, updateUserBody } from './user.schema';
import * as svc from './user.service';

export const userRoutes = Router();

userRoutes.get('/users', authorize('users.view'), validate({ query: listUserQuery }), async (req, res) => {
  const { rows, meta } = await svc.listUsers(req.principal!, validated<never, never, typeof listUserQuery>(req).query);
  paginated(res, rows, meta);
});
userRoutes.get('/users/:id', authorize('users.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getUser(req.principal!, validated<never, typeof idParams>(req).params.id));
});
userRoutes.post('/users', authorize('users.create'), validate({ body: createUserBody }), async (req, res) => {
  created(res, await svc.createUser(req.principal!, validated<typeof createUserBody>(req).body));
});
userRoutes.patch('/users/:id', authorize('users.edit'), validate({ params: idParams, body: updateUserBody }), async (req, res) => {
  const v = validated<typeof updateUserBody, typeof idParams>(req);
  ok(res, await svc.updateUser(req.principal!, v.params.id, v.body));
});
