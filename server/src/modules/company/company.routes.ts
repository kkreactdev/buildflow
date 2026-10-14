import { Router } from 'express';
import { z } from 'zod';
import { authorize, publicRoute } from '../../core/permissions/principal';
import { ok, created } from '../../lib/respond';
import { singleFileUpload } from '../../middleware/upload';
import { validate, validated } from '../../middleware/validate';
import { logoSlotSchema, updateCompanyBody } from './company.schema';
import * as svc from './company.service';

export const companyRoutes = Router();

/** Only the four known slots: the path parameter decides which field is replaced, never a caller-supplied key. */
const slotParams = z.object({ slot: logoSlotSchema });

/**
 * Branding for the login page, so it renders before anyone signs in. PUBLIC on purpose, and therefore
 * the smallest possible answer: the display name and four image URLs — never the legal name, GSTIN,
 * address or contact details. The sensitive fields need `company.view`.
 */
companyRoutes.get('/company/branding', publicRoute, async (_req, res) => {
  ok(res, await svc.getBranding());
});

/** The full profile, including the optional company details. */
companyRoutes.get('/company', authorize('company.view'), async (req, res) => {
  ok(res, await svc.getProfile(req.principal!));
});

companyRoutes.patch('/company', authorize('company.manage'), validate({ body: updateCompanyBody }), async (req, res) => {
  ok(res, await svc.updateProfile(req.principal!, validated<typeof updateCompanyBody, never>(req).body));
});

/**
 * Replace one branding image. Same middleware, provider and magic-byte checks as unit media — the file's
 * real type decides, never the browser's claim — under the shared media size budget.
 */
companyRoutes.post('/company/logo/:slot', authorize('company.manage'), validate({ params: slotParams }), singleFileUpload(), async (req, res) => {
  created(res, await svc.uploadLogo(req.principal!, validated<never, typeof slotParams>(req).params.slot, req.file));
});

companyRoutes.delete('/company/logo/:slot', authorize('company.manage'), validate({ params: slotParams }), async (req, res) => {
  ok(res, await svc.removeLogo(req.principal!, validated<never, typeof slotParams>(req).params.slot));
});

// Referenced so the inferred param type stays tied to the schema.
export type CompanyLogoSlotParam = z.infer<typeof logoSlotSchema>;