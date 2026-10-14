import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { createKeys, queryKeys } from './queryKeys';

export const masterKeys = createKeys('masters');

/** Registry of master types (labels, scope, which operations are allowed). Static per deploy, so cached long. */
export const useMasterTypes = () =>
  useQuery({ queryKey: queryKeys.masterTypes, queryFn: () => api.get('masters/types'), staleTime: 10 * 60_000 });

/**
 * Dropdown source: values for one or more types, grouped by type, ordered by the
 * admin-configured sort order. NEVER hard-code options in a page; use this.
 * `includeInactive` is for showing historical values on existing records.
 */
export function useMasterOptions(types, { branchId, includeInactive = false } = {}) {
  const list = [...types];
  return useQuery({
    queryKey: [...masterKeys.all, 'options', [...list].sort(), { branchId: branchId ?? null, includeInactive }],
    queryFn: ({ signal }) =>
      api.get('masters', { query: { types: list.join(','), activeOnly: !includeInactive, branchId }, signal }),
    staleTime: 5 * 60_000,
    enabled: list.length > 0,
  });
}

export const useMasterList = (type, params) =>
  useQuery({
    queryKey: masterKeys.list({ type, ...params }),
    queryFn: ({ signal }) => api.list(`masters/${type}`, { query: params, signal }),
    placeholderData: keepPreviousData,
    enabled: Boolean(type),
  });

/** Create / update / reorder / delete for one master type. All of them refresh every master list and dropdown. */
export function useMasterMutations(type) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: masterKeys.all });
  return {
    create: useMutation({ mutationFn: (body) => api.post(`masters/${type}`, body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`masters/${type}/${id}`, body), onSuccess: done }),
    reorder: useMutation({ mutationFn: (body) => api.post(`masters/${type}/reorder`, body), onSuccess: done }),
    remove: useMutation({ mutationFn: (id) => api.delete(`masters/${type}/${id}`), onSuccess: done }),
  };
}

export const useWorkflowStages = () =>
  useQuery({ queryKey: [...queryKeys.workflow, 'stages'], queryFn: () => api.get('workflow/stages') });

export function useWorkflowMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: queryKeys.workflow });
  return {
    create: useMutation({ mutationFn: (body) => api.post('workflow/stages', body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`workflow/stages/${id}`, body), onSuccess: done }),
    reorder: useMutation({ mutationFn: (ids) => api.post('workflow/stages/reorder', { ids }), onSuccess: done }),
  };
}
