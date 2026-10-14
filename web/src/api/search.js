import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './http';

/** `params`: { q, types?, limit?, page? }. Disabled until the term is long enough to be sent. */
export const useGlobalSearch = (params, enabled) =>
  useQuery({ queryKey: ['search', params], queryFn: ({ signal }) => api.get('search', { query: params, signal }), enabled, placeholderData: keepPreviousData, retry: false, staleTime: 15_000 });
