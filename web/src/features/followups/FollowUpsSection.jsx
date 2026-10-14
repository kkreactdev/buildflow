import { useState } from 'react';
import { useFollowUps } from '../../api/followups';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusPill as SharedStatusPill } from '../../components/ui/StatusPill';
import { usePermissions } from '../../hooks/usePermissions';
import { formatWhen } from './datetime';
import { FollowUpFormModal } from './FollowUpFormModal';
import { useFollowUpActions } from './useFollowUpActions';
import './followups.css';

export function StatusPill({ followUp }) {
  const s = followUp.status;
  return <SharedStatusPill statusKey={followUp.statusKey} label={s?.label} color={s?.color} />;
}

/** The follow-ups of one enquiry or client, with the actions this user may take. Used on both detail pages. */
export function FollowUpsSection({ anchor, branchId }) {
  const { can } = usePermissions();
  const canView = can('followups.view');
  const query = useFollowUps({ ...anchor, limit: 20, sort: '-scheduledAt' }, { enabled: canView });
  const actions = useFollowUpActions({ branchId });
  const [creating, setCreating] = useState(false);
  if (!canView) return null;
  const rows = query.data?.rows ?? [];

  return (
    <Card className="detail-card detail-section-full">
      <div className="fu-section-head">
        <h3>Follow-ups</h3>
        {can('followups.create') && <Button variant="secondary" onClick={() => setCreating(true)}>Schedule follow-up</Button>}
      </div>
      {query.isError ? (
        <EmptyState title="Follow-ups unavailable" description={query.error.message} />
      ) : rows.length === 0 && !query.isPending ? (
        <EmptyState title="No follow-ups yet" description="Schedule the next contact so nothing is forgotten." />
      ) : (
        <div aria-label="Follow-ups">
          {rows.map((f) => (
            <div key={f.id} className="fu-row">
              <div className="fu-row-main">
                <span>
                  <strong>{f.type?.label ?? 'Follow-up'}</strong> · <span className={f.statusKey === 'MISSED' ? 'fu-missed' : ''}>{formatWhen(f.scheduledAt)}</span> <StatusPill followUp={f} />
                </span>
                <span className="fu-row-meta">
                  {f.assignedToName ? `For ${f.assignedToName}` : ''}
                  {f.notes ? ` · ${f.notes}` : ''}
                  {f.outcome ? ` · Outcome: ${f.outcome}` : ''}
                  {f.cancelReason ? ` · Cancelled: ${f.cancelReason}` : ''}
                </span>
              </div>
              <ActionMenu items={actions.menuItems(f)} />
            </div>
          ))}
        </div>
      )}
      {creating && <FollowUpFormModal anchor={anchor} branchId={branchId} onClose={() => setCreating(false)} />}
      {actions.element}
    </Card>
  );
}
