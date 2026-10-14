import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { createKeys } from './queryKeys';
import { activityKeys } from './clients';

export const enquiryKeys = createKeys('enquiries');
export const transitionKey = (from) => ['workflow', 'transitions', from];

export const useEnquiries = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: enquiryKeys.list(params), queryFn: ({ signal }) => api.list('enquiries', { query: params, signal }), placeholderData: keepPreviousData, enabled });

/** Kanban data: one column per configured stage, with counts and a page of cards. */
export const useBoard = (params) =>
  useQuery({ queryKey: [...enquiryKeys.all, 'board', params], queryFn: ({ signal }) => api.get('enquiries/board', { query: params, signal }), placeholderData: keepPreviousData });

export const useEnquiry = (id) => useQuery({ queryKey: enquiryKeys.detail(id), queryFn: () => api.get(`enquiries/${id}`), enabled: Boolean(id) });

/** What the caller may do from a stage (backend-driven; the same rules the API enforces). */
export const fetchTransitions = (queryClient, from) =>
  queryClient.fetchQuery({ queryKey: transitionKey(from), queryFn: () => api.get('workflow/transitions', { query: { from } }), staleTime: 15_000 });
export const useTransitions = (from, enabled = true) =>
  useQuery({ queryKey: transitionKey(from), queryFn: () => api.get('workflow/transitions', { query: { from } }), staleTime: 15_000, enabled: Boolean(from) && enabled });

export function useEnquiryMutations() {
  const qc = useQueryClient();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: enquiryKeys.all }), qc.invalidateQueries({ queryKey: activityKeys.all })]);
  return {
    create: useMutation({ mutationFn: (body) => api.post('enquiries', body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`enquiries/${id}`, body), onSuccess: done }),
    assign: useMutation({ mutationFn: ({ id, ...body }) => api.post(`enquiries/${id}/assign`, body), onSuccess: done }),
    transition: useMutation({ mutationFn: ({ id, ...body }) => api.post(`enquiries/${id}/transition`, body), onSuccess: done }),
    lose: useMutation({ mutationFn: ({ id, ...body }) => api.post(`enquiries/${id}/lose`, body), onSuccess: done }),
    reopen: useMutation({ mutationFn: ({ id, ...body }) => api.post(`enquiries/${id}/reopen`, body), onSuccess: done }),
    archive: useMutation({ mutationFn: (id) => api.delete(`enquiries/${id}`), onSuccess: done }),
    /** The one conversion operation (POST /enquiries/:id/convert). It also changes the client list, the dashboard and the timeline. */
    convert: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`enquiries/${id}/convert`, body),
      onSuccess: () => Promise.all([done(), qc.invalidateQueries({ queryKey: ['clients'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]),
    }),
  };
}
