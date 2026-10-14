import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { createKeys } from './queryKeys';
import { activityKeys } from './clients';

export const followUpKeys = createKeys('followups');

export const useFollowUps = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: followUpKeys.list(params), queryFn: ({ signal }) => api.list('followups', { query: params, signal }), placeholderData: keepPreviousData, enabled });

/** Counts for the Today / Missed / Upcoming widgets, over the caller's scope. */
export const useFollowUpSummary = (params = {}, { enabled = true } = {}) =>
  useQuery({ queryKey: [...followUpKeys.all, 'summary', params], queryFn: ({ signal }) => api.get('followups/summary', { query: params, signal }), refetchInterval: 60_000, enabled });

export function useFollowUpMutations() {
  const qc = useQueryClient();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: followUpKeys.all }), qc.invalidateQueries({ queryKey: activityKeys.all })]);
  return {
    create: useMutation({ mutationFn: (body) => api.post('followups', body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`followups/${id}`, body), onSuccess: done }),
    complete: useMutation({ mutationFn: ({ id, ...body }) => api.post(`followups/${id}/complete`, body), onSuccess: done }),
    reschedule: useMutation({ mutationFn: ({ id, ...body }) => api.post(`followups/${id}/reschedule`, body), onSuccess: done }),
    cancel: useMutation({ mutationFn: ({ id, ...body }) => api.post(`followups/${id}/cancel`, body), onSuccess: done }),
    archive: useMutation({ mutationFn: (id) => api.delete(`followups/${id}`), onSuccess: done }),
  };
}
