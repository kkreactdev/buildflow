import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { idParams, toObjectId } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { Booking } from './booking.model';
import { createBookingBody, listBookingQuery, listConflictQuery, releaseBody, resolveConflictBody, updateBookingBody } from './booking.schema';
import * as svc from './booking.service';

/** A booking's timeline is readable only by someone who can see that booking (branch / salesperson scope). */
registerRefAuthorizer('booking', async (principal, id) => Boolean(await scopedRepo(Booking, principal).exists({ _id: toObjectId(id) })));

export const bookingRoutes = Router();

// Fixed paths before `/:id`.
bookingRoutes.get('/booking-conflicts', authorize('bookings.view'), validate({ query: listConflictQuery }), async (req, res) => {
  const { rows, meta } = await svc.listConflicts(req.principal!, validated<never, never, typeof listConflictQuery>(req).query);
  paginated(res, rows, meta);
});
bookingRoutes.post('/booking-conflicts/:id/resolve', authorize('bookings.resolve_conflict'), validate({ params: idParams, body: resolveConflictBody }), async (req, res) => {
  const v = validated<typeof resolveConflictBody, typeof idParams>(req);
  ok(res, await svc.resolveConflict(req.principal!, v.params.id, v.body));
});

bookingRoutes.get('/bookings', authorize('bookings.view'), validate({ query: listBookingQuery }), async (req, res) => {
  const { rows, meta } = await svc.listBookings(req.principal!, validated<never, never, typeof listBookingQuery>(req).query);
  paginated(res, rows, meta);
});
bookingRoutes.post('/bookings', authorize('bookings.create'), validate({ body: createBookingBody }), async (req, res) => {
  created(res, await svc.createBooking(req.principal!, validated<typeof createBookingBody>(req).body));
});
bookingRoutes.get('/bookings/:id', authorize('bookings.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getBooking(req.principal!, validated<never, typeof idParams>(req).params.id));
});
bookingRoutes.patch('/bookings/:id', authorize('bookings.edit'), validate({ params: idParams, body: updateBookingBody }), async (req, res) => {
  const v = validated<typeof updateBookingBody, typeof idParams>(req);
  ok(res, await svc.updateBooking(req.principal!, v.params.id, v.body));
});
// There is no delete and no generic status route: a booking only ever ends through release.
bookingRoutes.post('/bookings/:id/release', authorize('bookings.release'), validate({ params: idParams, body: releaseBody }), async (req, res) => {
  const v = validated<typeof releaseBody, typeof idParams>(req);
  ok(res, await svc.releaseBooking(req.principal!, v.params.id, v.body));
});
