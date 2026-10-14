import { InboxIcon } from './icons';
import './EmptyState.css';

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon ?? <InboxIcon size={28} />}</span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
