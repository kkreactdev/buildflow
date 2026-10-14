import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { listActivityQuery } from './activity.schema';
import * as svc from './activity.service';

/** Read-only: activities are only ever appended by services, never created or edited over the API. */
export const activityRoutes = Router();

activityRoutes.get('/activities', authorize('activities.view'), validate({ query: listActivityQuery }), async (req, res) => {
  const { rows, meta } = await svc.listActivities(req.principal!, validated<never, never, typeof listActivityQuery>(req).query);
  paginated(res, rows, meta);
});
