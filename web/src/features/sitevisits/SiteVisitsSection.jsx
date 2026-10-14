import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteVisits } from '../../api/sitevisits';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePermissions } from '../../hooks/usePermissions';
import { formatWhen } from '../followups/datetime';
import { SiteVisitFormModal } from './SiteVisitFormModal';
import { useVisitActions } from './useVisitActions';
import { VisitStatusPill } from './VisitStatusPill';
import './sitevisits.css';

/** The site visits of one enquiry, with the actions this user may take. `canSchedule` comes from the enquiry (not lost / not archived). */
export function SiteVisitsSection({ enquiry, canSchedule = true }) {
  const { can } = usePermissions();
  const canView = can('sitevisits.view');
  const query = useSiteVisits({ enquiryId: enquiry.id, limit: 20, sort: '-scheduledAt' }, { enabled: canView });
  const actions = useVisitActions();
  const [scheduling, setScheduling] = useState(false);
  if (!canView) return null;
  const rows = query.data?.rows ?? [];

  return (
    <Card className="detail-card detail-section-full">
      <div className="fu-section-head">
        <h3>Site visits</h3>
        {can('sitevisits.create') && canSchedule && <Button variant="secondary" onClick={() => setScheduling(true)}>Schedule site visit</Button>}
      </div>
      {query.isError ? (
        <EmptyState title="Site visits unavailable" description={query.error.message} />
      ) : rows.length === 0 && !query.isPending ? (
        <EmptyState title="No site visits yet" description="Schedule a visit to show this person the property." />
      ) : (
        <div aria-label="Site visits">
          {rows.map((v) => (
            <div key={v.id} className="visit-row">
              <div>
                <Link to={`/site-visits/${v.id}`}><strong>{v.visitNo}</strong></Link> · {formatWhen(v.scheduledAt)} <VisitStatusPill visit={v} />
                <div className="muted">
                  {v.assignedToName ? `By ${v.assignedToName}` : ''}
                  {v.units.length ? ` · ${v.units.map((u) => u.unitCode).join(', ')}` : ''}
                </div>
              </div>
              <ActionMenu items={actions.menuItems(v)} />
            </div>
          ))}
        </div>
      )}
      {scheduling && <SiteVisitFormModal enquiry={{ id: enquiry.id, enquiryNo: enquiry.enquiryNo, name: enquiry.name, branchId: enquiry.branchId }} onClose={() => setScheduling(false)} />}
      {actions.element}
    </Card>
  );
}
