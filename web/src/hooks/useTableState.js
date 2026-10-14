import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List-page state kept in the URL (shareable, survives refresh, back button
 * works). Everything the server needs is in `params`, ready to pass to
 * `api.list(path, { query: params })`.
 *
 *   const t = useTableState({ defaultSort: '-createdAt', filterKeys: ['status', 'branchId'] });
 *   t.params     -> { page, limit, sort, search, status, branchId }
 *   t.setFilter('status', 'NEW'), t.setSearch('raj'), t.setPage(2), t.setSort('name')
 */
export function useTableState({ defaultSort = '-createdAt', defaultLimit = 25, filterKeys = [] } = {}) {
  const [sp, setSp] = useSearchParams();

  const params = useMemo(() => {
    const out = {
      page: Math.max(1, Number(sp.get('page')) || 1),
      limit: Number(sp.get('limit')) || defaultLimit,
      sort: sp.get('sort') || defaultSort,
      search: sp.get('search') || '',
    };
    for (const key of filterKeys) {
      const v = sp.get(key);
      if (v) out[key] = v;
    }
    return out;
  }, [sp, defaultLimit, defaultSort, filterKeys]);

  const update = useCallback(
    (patch, { resetPage = true } = {}) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  const setPage = useCallback((page) => update({ page }, { resetPage: false }), [update]);
  const setSearch = useCallback((search) => update({ search }), [update]);
  const setFilter = useCallback((key, value) => update({ [key]: value }), [update]);

  /** Toggles asc -> desc -> asc on a field. */
  const setSort = useCallback(
    (field) => {
      const current = params.sort;
      update({ sort: current === field ? `-${field}` : field }, { resetPage: false });
    },
    [params.sort, update],
  );

  const reset = useCallback(() => setSp({}, { replace: true }), [setSp]);

  const activeFilterCount = filterKeys.filter((k) => params[k]).length;
  const hasActiveFilters = activeFilterCount > 0 || Boolean(params.search);

  return { params, setPage, setSearch, setFilter, setSort, reset, activeFilterCount, hasActiveFilters };
}
