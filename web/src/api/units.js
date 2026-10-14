import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from './clients';
import { api } from './http';
import { createKeys } from './queryKeys';

export const unitKeys = createKeys('units');

export const useUnits = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: unitKeys.list(params), queryFn: ({ signal }) => api.list('units', { query: params, signal }), placeholderData: keepPreviousData, enabled });

export const useUnit = (id) => useQuery({ queryKey: unitKeys.detail(id), queryFn: () => api.get(`units/${id}`), enabled: Boolean(id) });

/** Every unit operation refreshes lists, the detail page and the timeline. Status, assignment and media are separate controlled operations. */
export function useUnitMutations() {
  const qc = useQueryClient();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: unitKeys.all }), qc.invalidateQueries({ queryKey: activityKeys.all }), qc.invalidateQueries({ queryKey: ['audit'] })]);
  return {
    create: useMutation({ mutationFn: (body) => api.post('units', body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`units/${id}`, body), onSuccess: done }),
    assign: useMutation({ mutationFn: ({ id, ...body }) => api.post(`units/${id}/assign`, body), onSuccess: done }),
    setStatus: useMutation({ mutationFn: ({ id, ...body }) => api.post(`units/${id}/status`, body), onSuccess: done }),
    archive: useMutation({ mutationFn: (id) => api.delete(`units/${id}`), onSuccess: done }),
    addMedia: useMutation({
      mutationFn: ({ id, file, typeId, caption }) => {
        const form = new FormData();
        form.append('typeId', typeId);
        if (caption) form.append('caption', caption);
        form.append('file', file); // last, so the server has the fields before the file stream
        return api.upload(`units/${id}/media`, form);
      },
      onSuccess: done,
    }),
    removeMedia: useMutation({ mutationFn: ({ id, mediaId }) => api.delete(`units/${id}/media/${mediaId}`), onSuccess: done }),
  };
}
