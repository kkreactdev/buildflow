import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { AlertTriangleIcon } from './icons';
import './ChartPanel.css';

/**
 * Standard container for a chart: title, one-line explanation, optional tooltip definition, and consistent
 * loading / error / empty states. `state` is a react-query result or undefined (then children render directly).
 */
export function ChartPanel({ title, description, definition, actions, query, isEmpty, emptyTitle = 'Nothing to chart yet', children, className = '' }) {
  let body;
  if (query?.isPending) body = <Skeleton height={140} />;
  else if (query?.isError) {
    body = <p className="panel-note" role="alert"><AlertTriangleIcon size={16} /> {query.error?.status === 403 ? "You don't have permission to view this." : 'Could not load this section.'}</p>;
  } else if (isEmpty) body = <EmptyState title={emptyTitle} />;
  else body = children;
  return (
    <Card className={`chart-panel ${className}`} aria-label={title}>
      <header className="chart-panel-head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        <div className="chart-panel-actions">
          {actions}
          {definition && <span className="info-dot" role="note" tabIndex={0} title={definition} aria-label={`About ${title}: ${definition}`}>i</span>}
        </div>
      </header>
      {body}
    </Card>
  );
}
