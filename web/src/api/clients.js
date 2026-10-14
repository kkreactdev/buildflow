import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { createKeys } from './queryKeys';

export const clientKeys = createKeys('clients');
export const activityKeys = createKeys('activities');

export const useClients = (params) =>
  useQuery({
    queryKey: clientKeys.list(params),
    queryFn: ({ signal }) => api.list('clients', { query: params, signal }),
    placeholderData: keepPreviousData,
  });

export const useClient = (id) => useQuery({ queryKey: clientKeys.detail(id), queryFn: () => api.get(`clients/${id}`), enabled: Boolean(id) });

export function useClientMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: clientKeys.all });
  const doneAll = () => Promise.all([done(), qc.invalidateQueries({ queryKey: activityKeys.all })]);
  return {
    create: useMutation({ mutationFn: (body) => api.post('clients', body), onSuccess: doneAll }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`clients/${id}`, body), onSuccess: doneAll }),
    archive: useMutation({ mutationFn: (id) => api.delete(`clients/${id}`), onSuccess: doneAll }),
    updatePerson: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`persons/${id}`, body), onSuccess: doneAll }),
  };
}

/** Duplicate check for a phone number. Result: `{ status: 'NONE' | 'VISIBLE_MATCH' | 'HIDDEN_MATCH', person?, clients?, canLink? }`. */
export const lookupPhone = (phone) => api.post('persons/lookup', { phone });
export const linkPerson = (body) => api.post('persons/link', body);

/** A timeline for one entity (the server authorizes the entity itself, not just the permission). */
export const useTimeline = (refType, refId, params = {}) =>
  useQuery({
    queryKey: activityKeys.list({ refType, refId, ...params }),
    queryFn: ({ signal }) => api.list('activities', { query: { refType, refId, limit: 50, ...params }, signal }),
    enabled: Boolean(refType && refId),
    retry: false,
  });
