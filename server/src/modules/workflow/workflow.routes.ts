import { Router, type NextFunction, type Request, type Response } from 'express';
import { authorize, markGuard } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { created, ok } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import { createStageBody, listStagesQuery, reorderStagesBody, transitionsQuery, updateStageBody } from './workflow.schema';
import * as svc from './workflow.service';

export const workflowRoutes = Router();

const authorizeManage = markGuard((req: Request, _res: Response, next: NextFunction) => {
  try {
    svc.assertCanManageWorkflow(req.principal);
    next();
  } catch (err) {
    next(err);
  }
});

workflowRoutes.get('/workflow/stages', authorize('masters.view'), validate({ query: listStagesQuery }), async (req, res) => {
  ok(res, await svc.listStages(validated<never, never, typeof listStagesQuery>(req).query.includeInactive));
});

/** What the caller may do from a stage (drives Kanban drop targets). The same rules the API enforces on a move. */
workflowRoutes.get('/workflow/transitions', authorize('enquiries.view'), validate({ query: transitionsQuery }), async (req, res) => {
  const wf = await svc.loadWorkflow();
  ok(res, wf.availableTransitions(validated<never, never, typeof transitionsQuery>(req).query.from, req.principal!));
});

workflowRoutes.post('/workflow/stages', authorizeManage, validate({ body: createStageBody }), async (req, res) => {
  created(res, await svc.createStage(req.principal!, validated<typeof createStageBody>(req).body));
});
workflowRoutes.post('/workflow/stages/reorder', authorizeManage, validate({ body: reorderStagesBody }), async (req, res) => {
  ok(res, await svc.reorderStages(req.principal!, validated<typeof reorderStagesBody>(req).body));
});
workflowRoutes.patch('/workflow/stages/:id', authorizeManage, validate({ params: idParams, body: updateStageBody }), async (req, res) => {
  const v = validated<typeof updateStageBody, typeof idParams>(req);
  ok(res, await svc.updateStage(req.principal!, v.params.id, v.body));
});
