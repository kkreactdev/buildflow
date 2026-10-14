// Query-key factory so invalidation is predictable:
//   const keys = createKeys('enquiries');
//   keys.list({ page: 1 })  -> ['enquiries', 'list', { page: 1 }]
//   queryClient.invalidateQueries({ queryKey: keys.all })  // everything for the module
export function createKeys(resource) {
  return {
    all: [resource],
    lists: () => [resource, 'list'],
    list: (params = {}) => [resource, 'list', params],
    details: () => [resource, 'detail'],
    detail: (id) => [resource, 'detail', id],
  };
}

export const queryKeys = {
  session: ['session'],
  masters: (types = []) => ['masters', [...types].sort()],
  masterTypes: ['masters', 'types'],
  workflow: ['workflow'],
  permissionsCatalog: ['auth', 'permissions-catalog'],
  notifications: createKeys('notifications'),
};
