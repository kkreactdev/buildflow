import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityKeys, clientKeys } from './clients';
import { enquiryKeys } from './enquiries';
import { api } from './http';
import { createKeys } from './queryKeys';

export const referralKeys = createKeys('referrals');

export const useReferrals = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: referralKeys.list(params), queryFn: ({ signal }) => api.list('referrals', { query: params, signal }), placeholderData: keepPreviousData, enabled });

export const useReferral = (id) => useQuery({ queryKey: referralKeys.detail(id), queryFn: () => api.get(`referrals/${id}`), enabled: Boolean(id) });

/** Three creation flows (the server decides the type) plus the controlled operations on an existing referral. */
export function useReferralMutations() {
  const qc = useQueryClient();
  const done = () => Promise.all([referralKeys, enquiryKeys, activityKeys, clientKeys].map((k) => qc.invalidateQueries({ queryKey: k.all })).concat(qc.invalidateQueries({ queryKey: ['audit'] })));
  return {
    createExternal: useMutation({ mutationFn: (body) => api.post('referrals', body), onSuccess: done }),
    fromClient: useMutation({ mutationFn: ({ clientId, ...body }) => api.post(`referrals/from-client/${clientId}`, body), onSuccess: done }),
    fromUser: useMutation({ mutationFn: ({ userId, ...body }) => api.post(`referrals/from-user/${userId}`, body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`referrals/${id}`, body), onSuccess: done }),
    assign: useMutation({ mutationFn: ({ id, ...body }) => api.post(`referrals/${id}/assign`, body), onSuccess: done }),
    archive: useMutation({ mutationFn: (id) => api.delete(`referrals/${id}`), onSuccess: done }),
    linkEnquiry: useMutation({ mutationFn: ({ id, enquiryId }) => api.post(`referrals/${id}/enquiries`, { enquiryId }), onSuccess: done }),
    unlinkEnquiry: useMutation({ mutationFn: ({ id, enquiryId, reason }) => api.post(`referrals/${id}/enquiries/${enquiryId}/unlink`, { reason }), onSuccess: done }),
  };
}
