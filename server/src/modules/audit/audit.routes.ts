import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { listAuditQuery } from './audit.schema';
import * as svc from './audit.service';

/** Read-only by design: there is deliberately no create/update/delete route for the audit log. */
export const auditRoutes = Router();

auditRoutes.get('/audit', authorize('audit.view'), validate({ query: listAuditQuery }), async (req, res) => {
  const { rows, meta } = await svc.listAudit(req.principal!, validated<never, never, typeof listAuditQuery>(req).query);
  paginated(res, rows, meta);
});
auditRoutes.get('/audit/:id', authorize('audit.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getAudit(req.principal!, validated<never, typeof idParams>(req).params.id));
});
