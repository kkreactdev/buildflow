import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from './clients';
import { api } from './http';
import { createKeys } from './queryKeys';

export const documentKeys = createKeys('documents');

export const useDocuments = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: documentKeys.list(params), queryFn: ({ signal }) => api.list('documents', { query: params, signal }), placeholderData: keepPreviousData, enabled });

export const useDocument = (id) => useQuery({ queryKey: documentKeys.detail(id), queryFn: () => api.get(`documents/${id}`), enabled: Boolean(id) });

/** The record types a document can hang off, from the server (not hard-coded in the UI). */
export const useDocumentEntityTypes = ({ enabled = true } = {}) =>
  useQuery({ queryKey: [...documentKeys.all, 'entity-types'], queryFn: () => api.get('documents/entity-types'), staleTime: 10 * 60_000, enabled });

/**
 * Asks the server for a short-lived signed link and opens it. The link is requested at the moment of use (it expires within
 * minutes and is checked against the user's access every time); it is never cached or shown.
 */
export async function openDocument(id, version) {
  const { url } = await api.get(`documents/${id}/url`, { query: version ? { version } : undefined });
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) window.location.assign(url); // pop-up blocked: navigate instead
}

export function useDocumentMutations() {
  const qc = useQueryClient();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: documentKeys.all }), qc.invalidateQueries({ queryKey: activityKeys.all }), qc.invalidateQueries({ queryKey: ['audit'] })]);
  return {
    upload: useMutation({
      mutationFn: ({ entityType, entityId, file, documentTypeId, name, notes }) => {
        const form = new FormData();
        form.append('documentTypeId', documentTypeId);
        if (name) form.append('name', name);
        if (notes) form.append('notes', notes);
        form.append('file', file); // last, so the server has the fields before the file stream
        return api.upload('documents', form, { query: { entityType, entityId } });
      },
      onSuccess: done,
    }),
    replace: useMutation({
      mutationFn: ({ id, file }) => {
        const form = new FormData();
        form.append('file', file);
        return api.upload(`documents/${id}/file`, form);
      },
      onSuccess: done,
    }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`documents/${id}`, body), onSuccess: done }),
    archive: useMutation({ mutationFn: (id) => api.delete(`documents/${id}`), onSuccess: done }),
  };
}
