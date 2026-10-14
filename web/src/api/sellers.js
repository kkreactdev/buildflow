import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityKeys } from './clients';
import { unitKeys } from './units';
import { api } from './http';
import { createKeys } from './queryKeys';

export const sellerKeys = createKeys('sellers');

export const useSellers = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: sellerKeys.list(params), queryFn: ({ signal }) => api.list('sellers', { query: params, signal }), placeholderData: keepPreviousData, enabled });

export const useSeller = (id) => useQuery({ queryKey: sellerKeys.detail(id), queryFn: () => api.get(`sellers/${id}`), enabled: Boolean(id) });

/** The property pipeline across every seller — the operational worklist. */
export const useSellerProperties = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: sellerKeys.list(['properties', params]), queryFn: ({ signal }) => api.list('sellers/properties', { query: params, signal }), placeholderData: keepPreviousData, enabled });

export const useSellerProperty = (id) => useQuery({ queryKey: sellerKeys.detail('property', id), queryFn: () => api.get(`seller-properties/${id}`), enabled: Boolean(id) });

/**
 * Every seller operation in one hook. Which mutations are available is decided by the server's
 * `allowed` flags and its stage rules, so this hook never decides what the user may do.
 *
 * Unit queries are invalidated alongside the seller ones because completing a purchase creates a Unit —
 * leaving the Units page stale here would show stock that does not exist yet.
 */
export function useSellerMutations() {
  const qc = useQueryClient();
  const done = () =>
    Promise.all([
      sellerKeys.all,
      activityKeys.all,
      unitKeys.all,
    ].map((k) => qc.invalidateQueries({ queryKey: k })));
  return {
    create: useMutation({ mutationFn: (body) => api.post('sellers', body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`sellers/${id}`, body), onSuccess: done }),
    setSellerStatus: useMutation({ mutationFn: ({ id, ...body }) => api.post(`sellers/${id}/status`, body), onSuccess: done }),
    assign: useMutation({ mutationFn: ({ id, ...body }) => api.post(`sellers/${id}/assign`, body), onSuccess: done }),
    archive: useMutation({ mutationFn: (id) => api.delete(`sellers/${id}`), onSuccess: done }),

    addProperty: useMutation({ mutationFn: ({ id, ...body }) => api.post(`sellers/${id}/properties`, body), onSuccess: done }),
    updateProperty: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`seller-properties/${id}`, body), onSuccess: done }),
    verify: useMutation({ mutationFn: ({ id, ...body }) => api.post(`seller-properties/${id}/verify`, body), onSuccess: done }),
    negotiate: useMutation({ mutationFn: ({ id, ...body }) => api.post(`seller-properties/${id}/negotiations`, body), onSuccess: done }),
    approve: useMutation({ mutationFn: ({ id, ...body }) => api.post(`seller-properties/${id}/approve`, body), onSuccess: done }),
    purchase: useMutation({ mutationFn: ({ id, ...body }) => api.post(`seller-properties/${id}/purchase`, body), onSuccess: done }),
    refurbish: useMutation({ mutationFn: ({ id, ...body }) => api.post(`seller-properties/${id}/refurbish`, body), onSuccess: done }),
    readyToSell: useMutation({ mutationFn: ({ id, ...body }) => api.post(`seller-properties/${id}/ready-to-sell`, body), onSuccess: done }),
    reject: useMutation({ mutationFn: ({ id, ...body }) => api.post(`seller-properties/${id}/reject`, body), onSuccess: done }),
    withdraw: useMutation({ mutationFn: ({ id, ...body }) => api.post(`seller-properties/${id}/withdraw`, body), onSuccess: done }),
  };
}