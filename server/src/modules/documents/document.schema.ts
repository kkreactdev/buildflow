import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';
import { DOCUMENT_ENTITY_TYPES } from './document.entities';

const entityType = z.enum(DOCUMENT_ENTITY_TYPES);

/** Where a new document goes. In the query string (not the multipart body) so access is checked BEFORE the file is read. */
export const uploadQuery = z.object({ entityType, entityId: objectIdSchema }).strict();

/** The multipart text fields that travel with the file. */
export const uploadFields = z.object({ documentTypeId: objectIdSchema, name: z.string().trim().min(1).max(200).optional(), notes: z.string().trim().max(1000).optional() }).strict();

/** Descriptive fields only. The file, the record it belongs to and its branch have their own operations. */
export const updateDocumentBody = z
  .object({ documentTypeId: objectIdSchema, name: z.string().trim().min(1).max(200), notes: z.string().trim().max(1000).nullable() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const urlQuery = z.object({ version: z.coerce.number().int().min(1).optional() });

export const listDocumentQuery = pageQuerySchema
  .extend({
    entityType: entityType.optional(),
    entityId: objectIdSchema.optional(),
    documentTypeId: objectIdSchema.optional(),
    branchId: objectIdSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    isArchived: z.enum(['true', 'false']).default('false'),
  })
  .refine((q) => !q.entityId || Boolean(q.entityType), { message: 'Give the entityType together with an entityId', path: ['entityType'] });
