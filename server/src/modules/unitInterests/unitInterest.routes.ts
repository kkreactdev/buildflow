import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import * as svc from './unitInterest.service';

export const unitInterestRoutes = Router();

// Interested units of an enquiry, and of a unit. Recording interest needs enquiries.edit; it never changes the unit or a booking.
unitInterestRoutes.get('/enquiries/:id/unit-interests', authorize('enquiries.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.listForEnquiry(req.principal!, validated<never, typeof idParams>(req).params.id));
});
unitInterestRoutes.post('/enquiries/:id/unit-interests', authorize('enquiries.edit'), validate({ params: idParams, body: svc.addInterestBody }), async (req, res) => {
  const v = validated<typeof svc.addInterestBody, typeof idParams>(req);
  created(res, await svc.addInterest(req.principal!, v.params.id, v.body));
});
unitInterestRoutes.post('/unit-interests/:id/withdraw', authorize('enquiries.edit'), validate({ params: idParams, body: svc.withdrawInterestBody }), async (req, res) => {
  const v = validated<typeof svc.withdrawInterestBody, typeof idParams>(req);
  ok(res, await svc.withdrawInterest(req.principal!, v.params.id, v.body));
});
unitInterestRoutes.get('/units/:id/unit-interests', authorize('units.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.listForUnit(req.principal!, validated<never, typeof idParams>(req).params.id));
});

/**
 * Picker: the units ALREADY LINKED to this enquiry, resolved server-side from the one canonical
 * relationship model (interests + bookings + visits). The site-visit scheduler uses it so the modal
 * offers what this enquiry is actually about instead of every unit in the branch. `units` is null
 * when the caller may not view units and [] when nothing is linked — the two are not the same answer.
 */
unitInterestRoutes.get('/enquiries/:id/units', authorize('enquiries.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.linkedUnitsForEnquiry(req.principal!, validated<never, typeof idParams>(req).params.id));
});

/**
 * Picker: units the caller can offer as a NEW interest for this enquiry right now. Filters by
 * the enquiry's branch and excludes SOLD / booked / on-hold / archived units, so the modal
 * never shows a choice that the server would reject. The same rules are re-checked when the
 * interest is actually created, so a stale picker still fails safely.
 */
unitInterestRoutes.get('/enquiries/:id/eligible-units', authorize('enquiries.view'), validate({ params: idParams, query: svc.eligibleUnitsQuery }), async (req, res) => {
  const v = validated<typeof svc.eligibleUnitsQuery, typeof idParams>(req);
  const { rows, meta } = await svc.listEligibleUnitsForEnquiry(req.principal!, v.params.id, v.query);
  paginated(res, rows, meta);
});
