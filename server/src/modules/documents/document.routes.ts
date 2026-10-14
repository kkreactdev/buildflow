import { Router } from 'express';
import { getEnv } from '../../config/env';
import { authorize } from '../../core/permissions/principal';
import { idParams } from '../../lib/ids';
import { created, ok, paginated } from '../../lib/respond';
import { singleFileUpload } from '../../middleware/upload';
import { validate, validated } from '../../middleware/validate';
import { registerRefAuthorizer } from '../activities/refAuthorizers';
import { listDocumentQuery, updateDocumentBody, uploadFields, uploadQuery, urlQuery } from './document.schema';
import * as svc from './document.service';

/** A document's timeline is readable only by someone who may access the document (and so the record it hangs off). */
registerRefAuthorizer('document', (principal, id) => svc.canSee(principal, id));

export const documentRoutes = Router();
const upload = singleFileUpload(() => getEnv().DOCUMENT_MAX_BYTES);

documentRoutes.get('/documents/entity-types', authorize('documents.view'), (_req, res) => ok(res, svc.entityTypes()));
documentRoutes.get('/documents', authorize('documents.view'), validate({ query: listDocumentQuery }), async (req, res) => {
  const { rows, meta } = await svc.listDocuments(req.principal!, validated<never, never, typeof listDocumentQuery>(req).query);
  paginated(res, rows, meta);
});

// Upload: permission and the target record are checked BEFORE the file body is read, so an unauthorized caller uploads nothing.
documentRoutes.post(
  '/documents',
  authorize('documents.upload'),
  validate({ query: uploadQuery }),
  async (req, _res, next) => {
    try {
      const q = validated<never, never, typeof uploadQuery>(req).query;
      await svc.assertCanUploadTo(req.principal!, q.entityType, q.entityId);
      next();
    } catch (err) {
      next(err);
    }
  },
  upload,
  async (req, res) => {
    const q = validated<never, never, typeof uploadQuery>(req).query;
    created(res, await svc.uploadDocument(req.principal!, q, req.file, uploadFields.parse(req.body)));
  },
);

documentRoutes.get('/documents/:id', authorize('documents.view'), validate({ params: idParams }), async (req, res) => {
  ok(res, await svc.getDocument(req.principal!, validated<never, typeof idParams>(req).params.id));
});
documentRoutes.get('/documents/:id/url', authorize('documents.view'), validate({ params: idParams, query: urlQuery }), async (req, res) => {
  const v = validated<never, typeof idParams, typeof urlQuery>(req);
  ok(res, await svc.accessUrl(req.principal!, v.params.id, v.query.version));
});
documentRoutes.patch('/documents/:id', authorize('documents.edit'), validate({ params: idParams, body: updateDocumentBody }), async (req, res) => {
  const v = validated<typeof updateDocumentBody, typeof idParams>(req);
  ok(res, await svc.updateDocument(req.principal!, v.params.id, v.body));
});
documentRoutes.post(
  '/documents/:id/file',
  authorize('documents.upload'),
  validate({ params: idParams }),
  async (req, _res, next) => {
    try {
      await svc.assertCanReplace(req.principal!, validated<never, typeof idParams>(req).params.id);
      next();
    } catch (err) {
      next(err);
    }
  },
  upload,
  async (req, res) => {
    ok(res, await svc.replaceFile(req.principal!, validated<never, typeof idParams>(req).params.id, req.file));
  },
);
documentRoutes.delete('/documents/:id', authorize('documents.archive'), validate({ params: idParams }), async (req, res) => {
  await svc.archiveDocument(req.principal!, validated<never, typeof idParams>(req).params.id);
  res.status(204).end();
});
