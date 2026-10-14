import { Router } from 'express';
import { authenticatedOnly } from '../../core/permissions/principal';
import { ok } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { search, searchQuery } from './search.service';

export const searchRoutes = Router();

// Any signed-in user may call it; WHAT is searched is decided per record type by that type's view permission and scoped repository.
searchRoutes.get('/search', authenticatedOnly, validate({ query: searchQuery }), async (req, res) => {
  ok(res, await search(req.principal!, validated<never, never, typeof searchQuery>(req).query));
});
