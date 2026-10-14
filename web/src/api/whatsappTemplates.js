import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { createKeys } from './queryKeys';

export const templateKeys = createKeys('whatsapp-templates');

export const useTemplates = (params, { enabled = true } = {}) =>
  useQuery({ queryKey: templateKeys.list(params), queryFn: ({ signal }) => api.list('whatsapp-templates', { query: params, signal }), placeholderData: keepPreviousData, enabled });

/** The supported placeholders (a code-defined list owned by the server). */
export const useTemplateVariables = ({ enabled = true } = {}) =>
  useQuery({ queryKey: [...templateKeys.all, 'variables'], queryFn: () => api.get('whatsapp-templates/variables'), staleTime: 10 * 60_000, enabled });

export function useTemplateMutations() {
  const qc = useQueryClient();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: templateKeys.all }), qc.invalidateQueries({ queryKey: ['audit'] })]);
  return {
    create: useMutation({ mutationFn: (body) => api.post('whatsapp-templates', body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`whatsapp-templates/${id}`, body), onSuccess: done }),
    archive: useMutation({ mutationFn: (id) => api.delete(`whatsapp-templates/${id}`), onSuccess: done }),
  };
}
