import { useMasterOptions } from '../../api/masters';
import { formatDateTime } from '../../lib/format';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import './Timeline.css';

/**
 * Renders activity entries (newest first). Activity type labels come from the
 * ACTIVITY_TYPE master, so renaming a type in Masters renames it here.
 */
export function Timeline({ query, emptyTitle = 'No activity yet', emptyDescription }) {
  const types = useMasterOptions(['ACTIVITY_TYPE'], { includeInactive: true });
  const label = (code) => types.data?.ACTIVITY_TYPE?.find((t) => t.code === code)?.label ?? code;

  if (query.isPending) return <Skeleton height={48} />;
  if (query.isError) return <EmptyState title="Timeline unavailable" description={query.error?.message} />;
  const rows = query.data?.rows ?? [];
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <ol className="timeline">
      {rows.map((a) => (
        <li key={a._id} className="timeline-item">
          <span className="timeline-dot" />
          <div>
            <div className="timeline-title">{a.description}</div>
            <div className="timeline-meta">
              {label(a.type)} · {formatDateTime(a.at)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
