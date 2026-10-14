import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { createKeys, queryKeys } from './queryKeys';

export const userKeys = createKeys('users');
export const roleKeys = createKeys('roles');
export const branchKeys = createKeys('branches');

const listQuery = (keys, path, params, extra = {}) => ({
  ...extra,
  queryKey: keys.list(params),
  queryFn: ({ signal }) => api.list(path, { query: params, signal }),
  placeholderData: keepPreviousData,
});

export const useUsers = (params, { enabled = true } = {}) => useQuery(listQuery(userKeys, 'users', params, { enabled }));
export const useRoles = (params = { limit: 100 }) => useQuery(listQuery(roleKeys, 'roles', params));
export const useBranches = (params = { limit: 100 }) => useQuery(listQuery(branchKeys, 'branches', params));
export const usePermissionsCatalog = () =>
  useQuery({ queryKey: queryKeys.permissionsCatalog, queryFn: () => api.get('auth/permissions-catalog'), staleTime: 5 * 60_000 });

/** Create/update/delete helper: invalidates the module's lists afterwards. */
function useSave(keys, path) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.all });
  return {
    create: useMutation({ mutationFn: (body) => api.post(path, body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }) => api.patch(`${path}/${id}`, body), onSuccess: done }),
    remove: useMutation({ mutationFn: (id) => api.delete(`${path}/${id}`), onSuccess: done }),
  };
}
export const useUserMutations = () => useSave(userKeys, 'users');
export const useRoleMutations = () => useSave(roleKeys, 'roles');
export const useBranchMutations = () => useSave(branchKeys, 'branches');
