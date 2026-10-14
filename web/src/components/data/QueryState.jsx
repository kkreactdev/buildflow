import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { AlertTriangleIcon } from '../ui/icons';

/**
 * Standard loading / error / empty handling for a react-query result:
 *   <QueryState query={q} isEmpty={(d) => d.rows.length === 0} empty={{ title: '...' }}>{(data) => ...}</QueryState>
 */
export function QueryState({ query, isEmpty, empty, skeletonRows = 4, children }) {
  if (query.isPending) {
    return (
      <div className="query-state-loading" role="status" aria-label="Loading">
        {Array.from({ length: skeletonRows }, (_, i) => (
          <Skeleton key={i} height={18} style={{ marginBottom: 12 }} />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertTriangleIcon size={28} />}
        title="Could not load data"
        description={query.error?.message}
        action={
          <Button variant="secondary" onClick={() => query.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  if (isEmpty?.(query.data)) return <EmptyState {...empty} />;
  return children(query.data);
}
