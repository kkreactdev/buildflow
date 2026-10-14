import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { ok } from '../../lib/respond';
import * as svc from './report.service';

export const reportRoutes = Router();

// Which reports exist for this user, then one report as JSON (paginated), then the same report as CSV.
// Each report's filters are validated by that report's own schema (the same one its module's list uses).
reportRoutes.get('/reports', authorize('reports.view'), (req, res) => ok(res, svc.listReports(req.principal!)));
reportRoutes.get('/reports/:key', authorize('reports.view'), async (req, res) => {
  ok(res, await svc.runReport(req.principal!, String(req.params.key), req.query));
});
reportRoutes.get('/reports/:key/export.csv', authorize('reports.export'), async (req, res) => {
  // Headers go out with the first chunk, AFTER the size check, so a refusal is still a normal JSON error.
  const key = String(req.params.key);
  let started = false;
  await svc.exportReport(req.principal!, key, req.query, (chunk) => {
    if (!started) {
      started = true;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${key}-report.csv"`);
    }
    res.write(chunk);
  });
  res.end();
});
