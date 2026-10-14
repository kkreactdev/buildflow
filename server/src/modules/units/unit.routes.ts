import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { idParams, toObjectId } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { singleFileUpload } from '../../middleware/upload';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { Unit } from './unit.model';
import { assignBody, createUnitBody, listUnitQuery, mediaParams, mediaUploadBody, statusBody, updateUnitBody } from './unit.schema';
import * as svc from './unit.service';

/** A unit's timeline is readable only by someone who can see that unit (branch / assignment scope). */
registerRefAuthorizer('unit', async (principal, id) => Boolean(await scopedRepo(Unit, principal, { includeArchived: true }).exists({ _id: toObjectId(id) })));

export const unitRoutes = Router();

unitRoutes.get('/units', authorize('units.view'), validate({ query: listUnitQuery }), async (req, res) => {
  const { rows, meta } = await svc.listUnits(req.principal!, validated<never, never, typeof listUnitQuery>(req).query);
  paginated(res, rows, meta);
});
unitRoutes.post('/units', authorize('units.create'), validate({ body: createUnitBody }), async (req, res) => {
  created(res, await svc.createUnit(req.principal!, validated<typeof createUnitBody>(req).body));
});
unitRoutes.get('/units/:id', authorize('units.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getUnit(req.principal!, validated<never, typeof idParams>(req).params.id));
});
unitRoutes.patch('/units/:id', authorize('units.edit'), validate({ params: idParams, body: updateUnitBody }), async (req, res) => {
  const v = validated<typeof updateUnitBody, typeof idParams>(req);
  ok(res, await svc.updateUnit(req.principal!, v.params.id, v.body));
});
unitRoutes.delete('/units/:id', authorize('units.archive'), validate({ params: idParams }), async (req, res) => {
  await svc.archiveUnit(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});

// Controlled operations: each has its own permission and rules.
unitRoutes.post('/units/:id/assign', authorize('units.assign'), validate({ params: idParams, body: assignBody }), async (req, res) => {
  const v = validated<typeof assignBody, typeof idParams>(req);
  ok(res, await svc.assignUnit(req.principal!, v.params.id, v.body));
});
unitRoutes.post('/units/:id/status', authorize('units.change_status'), validate({ params: idParams, body: statusBody }), async (req, res) => {
  const v = validated<typeof statusBody, typeof idParams>(req);
  ok(res, await svc.changeUnitStatus(req.principal!, v.params.id, v.body));
});

// Media. Listing needs units.view; changing it needs units.manage_media. Scope is checked BEFORE the file body is read.
unitRoutes.get('/units/:id/media', authorize('units.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.listMedia(req.principal!, validated<never, typeof idParams>(req).params.id));
});
unitRoutes.post(
  '/units/:id/media',
  authorize('units.manage_media'),
  validate({ params: idParams }),
  async (req, _res, next) => {
    try {
      await svc.assertUnitAccess(req.principal!, validated<never, typeof idParams>(req).params.id);
      next();
    } catch (err) {
      next(err);
    }
  },
  singleFileUpload(),
  async (req, res) => {
    const id = validated<never, typeof idParams>(req).params.id;
    const body = mediaUploadBody.parse(req.body);
    created(res, await svc.addMedia(req.principal!, id, req.file, body));
  },
);
unitRoutes.delete('/units/:id/media/:mediaId', authorize('units.manage_media'), validate({ params: mediaParams }), async (req, res) => {
  const p = validated<never, typeof mediaParams>(req).params;
  await svc.removeMedia(req.principal!, p.id, p.mediaId);
  res.status(204).end();
});
