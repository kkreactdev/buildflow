import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { listNotificationQuery } from './notification.schema';
import * as svc from './notification.service';

/** Read and acknowledge your OWN notifications. There is no way to create or delete one over the API. */
export const notificationRoutes = Router();

notificationRoutes.get('/notifications', authorize('notifications.view'), validate({ query: listNotificationQuery }), async (req, res) => {
  const { rows, meta } = await svc.listNotifications(req.principal!, validated<never, never, typeof listNotificationQuery>(req).query);
  paginated(res, rows, meta);
});
notificationRoutes.get('/notifications/unread-count', authorize('notifications.view'), async (req, res) => {
  ok(res, { unread: await svc.unreadCount(req.principal!) });
});
notificationRoutes.post('/notifications/read-all', authorize('notifications.view'), async (req, res) => {
  ok(res, { updated: await svc.markAllRead(req.principal!) });
});
notificationRoutes.post('/notifications/:id/read', authorize('notifications.view'), validate({ params: idParams }), async (req, res) => {
  await svc.markRead(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
