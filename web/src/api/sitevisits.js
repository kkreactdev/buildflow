import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from './clients';
import { enquiryKeys } from './enquiries';
import { followUpKeys } from './followups';
import { api } from './http';
import { createKeys } from './queryKeys';

export const siteVisitKeys = createKeys('sitevisits');

export const useSiteVisits = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: siteVisitKeys.list(params), queryFn: ({ signal }) => api.list('sitevisits', { query: params, signal }), placeholderData: keepPreviousData, enabled });

export const useSiteVisit = (id) => useQuery({ queryKey: siteVisitKeys.detail(id), queryFn: () => api.get(`sitevisits/${id}`), enabled: Boolean(id) });

/**
 * Lifecycle operations are separate calls (there is no generic status update). Scheduling and completing also
 * move the enquiry and (on completion) create a follow-up, so those lists are refreshed too.
 */
export function useSiteVisitMutations() {
  const qc = useQueryClient();
  const done = () =>
    Promise.all([siteVisitKeys, enquiryKeys, followUpKeys, activityKeys].map((k) => qc.invalidateQueries({ queryKey: k.all })).concat(qc.invalidateQueries({ queryKey: ['audit'] })));
  return {
    create: useMutation({ mutationFn: (body) => api.post('sitevisits', body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`sitevisits/${id}`, body), onSuccess: done }),
    assign: useMutation({ mutationFn: ({ id, ...body }) => api.post(`sitevisits/${id}/assign`, body), onSuccess: done }),
    complete: useMutation({ mutationFn: ({ id, ...body }) => api.post(`sitevisits/${id}/complete`, body), onSuccess: done }),
    cancel: useMutation({ mutationFn: ({ id, ...body }) => api.post(`sitevisits/${id}/cancel`, body), onSuccess: done }),
    archive: useMutation({ mutationFn: (id) => api.delete(`sitevisits/${id}`), onSuccess: done }),
  };
}
