import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { Pagination } from '../ui/Pagination';
import { Skeleton } from '../ui/Skeleton';
import { AlertTriangleIcon, ArrowDownIcon, ArrowUpIcon } from '../ui/icons';
import './data.css';

/**
 * Server-driven table: sorting, paging and filtering happen on the API; this
 * component only renders and reports intent.
 *
 * columns: [{ key, header, render?(row), sortable?, align?, width?, wrap?, minWidth? }]
 *   By default a cell never wraps (phones, ids, names and badges stay in one piece) and the table is as wide as its content
 *   needs, scrolling horizontally inside its own container when that is wider than the page. Set `wrap` on a column that holds
 *   free text (notes, addresses) so it wraps within `minWidth` (default 220px) instead of stretching the table.
 * sort:    current sort string, e.g. '-createdAt'  (leading '-' = descending)
 * meta:    { page, limit, total } straight from `api.list`
 */
export function DataTable({
  columns,
  rows,
  getRowId = (r) => r.id ?? r._id,
  loading = false,
  error = null,
  onRetry,
  sort,
  onSortChange,
  meta,
  onPageChange,
  onRowClick,
  rowActions,
  empty = { title: 'Nothing here yet' },
}) {
  const sortField = sort?.replace(/^-/, '');
  const sortDesc = sort?.startsWith('-');

  if (error) {
    return (
      <EmptyState
        icon={<AlertTriangleIcon size={28} />}
        title="Could not load data"
        description={error.message}
        action={onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
      />
    );
  }

  const showSkeleton = loading && (!rows || rows.length === 0);
  const isEmpty = !loading && (!rows || rows.length === 0);
  const colCount = columns.length + (rowActions ? 1 : 0);

  return (
    <div className="data-table-wrap">
      <div className="data-table-scroll" role="region" aria-label="Table: scroll sideways to see every column" tabIndex={0}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = c.sortable && sortField === c.key;
              return (
                <th
                  key={c.key}
                  className={c.wrap ? 'is-wrap' : undefined}
                  style={{ width: c.width, minWidth: c.wrap ? (c.minWidth ?? 220) : c.minWidth, textAlign: c.align }}
                  aria-sort={active ? (sortDesc ? 'descending' : 'ascending') : undefined}
                >
                  {c.sortable && onSortChange ? (
                    <button type="button" className="data-table-sort" onClick={() => onSortChange(c.key)}>
                      {c.header}
                      {active && (sortDesc ? <ArrowDownIcon size={12} /> : <ArrowUpIcon size={12} />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
            {rowActions && <th className="data-table-actions-col" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody aria-busy={loading}>
          {showSkeleton &&
            Array.from({ length: 5 }, (_, i) => (
              <tr key={`sk-${i}`}>
                <td colSpan={colCount}>
                  <Skeleton height={16} />
                </td>
              </tr>
            ))}
          {!showSkeleton &&
            rows?.map((row) => (
              <tr key={getRowId(row)} className={onRowClick ? 'is-clickable' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.wrap ? 'is-wrap' : undefined} style={{ textAlign: c.align }}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
                {rowActions && (
                  <td className="data-table-actions-col" onClick={(e) => e.stopPropagation()}>
                    {rowActions(row)}
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
      </div>
      {isEmpty && <EmptyState {...empty} />}
      {meta && onPageChange && (
        <Pagination
          page={meta.page}
          pageSize={meta.limit}
          totalCount={meta.total}
          totalPages={Math.max(1, Math.ceil(meta.total / meta.limit))}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}
