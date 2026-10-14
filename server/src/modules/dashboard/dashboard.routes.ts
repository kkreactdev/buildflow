import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { ok } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { dashboardQuery } from './dashboard.range';
import * as svc from './dashboard.service';

export const dashboardRoutes = Router();

// All four need `dashboard.view`; each section additionally needs the matching resource permission (enforced in the service).
dashboardRoutes.get('/dashboard/summary', authorize('dashboard.view'), validate({ query: dashboardQuery }), async (req, res) => {
  ok(res, await svc.summary(req.principal!, validated<never, never, typeof dashboardQuery>(req).query));
});
dashboardRoutes.get('/dashboard/funnel', authorize('dashboard.view'), validate({ query: dashboardQuery }), async (req, res) => {
  ok(res, await svc.funnel(req.principal!, validated<never, never, typeof dashboardQuery>(req).query));
});
dashboardRoutes.get('/dashboard/sources', authorize('dashboard.view'), validate({ query: dashboardQuery }), async (req, res) => {
  ok(res, await svc.sources(req.principal!, validated<never, never, typeof dashboardQuery>(req).query));
});
dashboardRoutes.get('/dashboard/performance', authorize('dashboard.view'), validate({ query: dashboardQuery }), async (req, res) => {
  ok(res, await svc.performance(req.principal!, validated<never, never, typeof dashboardQuery>(req).query));
});
