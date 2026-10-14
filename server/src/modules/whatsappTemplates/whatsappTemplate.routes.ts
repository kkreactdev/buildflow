import { Router, type NextFunction, type Request, type Response } from 'express';
import { authorize, markGuard } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { createTemplateBody, listTemplateQuery, updateTemplateBody } from './whatsappTemplate.schema';
import * as svc from './whatsappTemplate.service';

export const whatsappTemplateRoutes = Router();

/** Guard for writes, before validation: 401 / 403 never reveal the payload rules. Templates are company-wide, so this also needs all-branch access. */
const authorizeManage = markGuard((req: Request, _res: Response, next: NextFunction) => {
  try {
    svc.assertCanManageTemplates(req.principal);
    next();
  } catch (err) {
    next(err);
  }
});

// Fixed path before `/:id`. There is no send / test-send route: V1 stores templates only.
whatsappTemplateRoutes.get('/whatsapp-templates/variables', authorize('whatsapp_masters.view'), (_req, res) => ok(res, svc.variableList()));
whatsappTemplateRoutes.get('/whatsapp-templates', authorize('whatsapp_masters.view'), validate({ query: listTemplateQuery }), async (req, res) => {
  const { rows, meta } = await svc.listTemplates(req.principal!, validated<never, never, typeof listTemplateQuery>(req).query);
  paginated(res, rows, meta);
});
whatsappTemplateRoutes.get('/whatsapp-templates/:id', authorize('whatsapp_masters.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getTemplate(req.principal!, validated<never, typeof idParams>(req).params.id));
});
whatsappTemplateRoutes.post('/whatsapp-templates', authorizeManage, validate({ body: createTemplateBody }), async (req, res) => {
  created(res, await svc.createTemplate(req.principal!, validated<typeof createTemplateBody>(req).body));
});
whatsappTemplateRoutes.patch('/whatsapp-templates/:id', authorizeManage, validate({ params: idParams, body: updateTemplateBody }), async (req, res) => {
  const v = validated<typeof updateTemplateBody, typeof idParams>(req);
  ok(res, await svc.updateTemplate(req.principal!, v.params.id, v.body));
});
whatsappTemplateRoutes.delete('/whatsapp-templates/:id', authorizeManage, validate({ params: idParams }), async (req, res) => {
  await svc.archiveTemplate(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
