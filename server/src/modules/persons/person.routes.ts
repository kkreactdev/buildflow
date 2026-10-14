import { Router } from 'express';
import { authorize } from '../../core/permissions/principal';
import { identityLimiter } from '../../middleware/identityLimiter';
import { idParams } from '../../lib/ids';
import { created, ok } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { createPersonBody, linkBody, lookupBody, updatePersonBody } from './person.schema';
import * as svc from './person.service';

/**
 * Deliberately no list/search/get-by-id endpoint: people are discovered only through the
 * branch-scoped records that relate them to the caller (clients today), or by checking one
 * specific phone number (existence-only when the match is in another branch).
 */
export const personRoutes = Router();

/** 200 for every outcome so the UI can branch on `status`: NONE | VISIBLE_MATCH | HIDDEN_MATCH. Invalid phone is 400. */
personRoutes.post('/persons/lookup', authorize('persons.lookup'), identityLimiter, validate({ body: lookupBody }), async (req, res) => {
  ok(res, await svc.lookupPhone(req.principal!, validated<typeof lookupBody>(req).body.phone));
});

/** 201 = created; 409 PERSON_EXISTS (details carry the match) = existing; 400 = invalid input. Never creates a second person. */
personRoutes.post('/persons', authorize('persons.create'), identityLimiter, validate({ body: createPersonBody }), async (req, res) => {
  created(res, await svc.createPerson(req.principal!, validated<typeof createPersonBody>(req).body));
});

personRoutes.post('/persons/link', authorize('persons.link'), identityLimiter, validate({ body: linkBody }), async (req, res) => {
  ok(res, await svc.linkPerson(req.principal!, validated<typeof linkBody>(req).body));
});

personRoutes.patch('/persons/:id', authorize('persons.edit'), identityLimiter, validate({ params: idParams, body: updatePersonBody }), async (req, res) => {
  const v = validated<typeof updatePersonBody, typeof idParams>(req);
  ok(res, await svc.updatePerson(req.principal!, v.params.id, v.body));
});
