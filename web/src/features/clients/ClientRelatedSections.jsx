import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { LockIcon } from '../../components/ui/icons';
import { usePermissions } from '../../hooks/usePermissions';
import { StageBadge } from '../enquiries/StageBadge';
import { StatusPill as FollowUpStatusPill } from '../followups/FollowUpsSection';
import { formatWhen } from '../followups/datetime';
import { UnitsSection } from '../relations/UnitsSection';
import { SiteVisitFormModal } from '../sitevisits/SiteVisitFormModal';
import { VisitStatusPill } from '../sitevisits/VisitStatusPill';
import '../sitevisits/sitevisits.css';

/** Hidden by permission (different from empty): say so instead of showing "none". */
const Restricted = ({ what }) => <p className="muted" role="note"><LockIcon size={14} /> You don't have permission to view {what}.</p>;

/** Schedule from the client page: the visit is for one of THIS client's enquiries, so the modal is given
 *  their enquiries (a closed list) and their client id (so the unit picker offers the client's linked
 *  units, not the whole branch). */
function ClientSiteVisitsSection({ section, query }) {
  const { can } = usePermissions();
  const [scheduling, setScheduling] = useState(false);
  // The visit is raised on an ENQUIRY, so the closed list it offers is the client's own open enquiries —
  // not their existing visits, and not a search across every enquiry the caller can see.
  const open = (query.data?.enquiries?.rows ?? []).filter((e) => !e.isArchived && e.stage?.kind !== 'LOST');
  return (
    <Section
      title="Site visits"
      query={query}
      section={section}
      what="site visits"
      empty="No site visits"
      emptyText="Visits of this client's enquiries appear here."
      action={can('sitevisits.create') && open.length > 0 ? <Button variant="secondary" onClick={() => setScheduling(true)}>Schedule site visit</Button> : null}
      // Rendered by the SECTION, not by `children`: the section takes over its body for the pending,
      // error and empty states, and a client with no visits yet must still be able to schedule one.
      after={scheduling && <SiteVisitFormModal clientId={query.data.clientId} enquiries={open} onClose={() => setScheduling(false)} />}
    >
      {(rows) => rows.map((v) => (
        <div key={v.id} className="visit-row">
          <div>
            <Link to={`/site-visits/${v.id}`}><strong>{v.visitNo}</strong></Link> · {formatWhen(v.scheduledAt)} <VisitStatusPill visit={v} />
            <div className="muted">
              {v.assignedToName ? `By ${v.assignedToName}` : ''}
              {v.units?.length ? ` · ${v.units.map((u) => u.unitCode).join(', ')}` : ''}
              {' · '}<Link to={`/enquiries/${v.enquiryId}`}>{v.enquiryNo}</Link>
            </div>
          </div>
        </div>
      ))}
    </Section>
  );
}

function Section({ title, query, section, what, empty, emptyText, action, after, children }) {
  return (
    <Card className="detail-card" aria-label={title}>
      <div className="fu-section-head"><h3>{title}</h3>{action}</div>
      {query.isPending ? <Skeleton height={44} />
        : query.isError ? <EmptyState title={`${title} unavailable`} description={query.error?.message} />
        : section === null ? <Restricted what={what} />
        : section.rows.length === 0 ? <EmptyState title={empty} description={emptyText} />
        : <div aria-label={title}>{children(section.rows)}{section.truncated && <p className="muted">Showing the latest {section.rows.length}.</p>}</div>}
      {after}
    </Card>
  );
}

/**
 * The client's connected records, all resolved by the server through the client's identity (person + branch), so a follow-up
 * or visit raised on one of the client's enquiries, or a booking made before they became a client, shows up here. Nothing is
 * filtered or guessed in the browser.
 */
export function ClientRelatedSections({ related }) {
  const d = related.data;

  return (
    <>
      <Section title="Enquiries" query={related} section={d?.enquiries} what="enquiries" empty="No enquiries" emptyText="No enquiry is recorded for this client.">
        {(rows) => <ul>{rows.map((e) => <li key={e.id}><Link to={`/enquiries/${e.id}`}>{e.enquiryNo}</Link> <StageBadge stage={e.stage} /></li>)}</ul>}
      </Section>

      <Section title="Follow-ups" query={related} section={d?.followUps} what="follow-ups" empty="No follow-ups" emptyText="Follow-ups of this client and of its enquiries appear here.">
        {(rows) => rows.map((f) => (
          <div key={f.id} className="visit-row">
            <div>
              <strong>{f.type?.label ?? 'Follow-up'}</strong> · <span className={f.statusKey === 'MISSED' ? 'fu-missed' : ''}>{formatWhen(f.scheduledAt)}</span> <FollowUpStatusPill followUp={f} />
              <div className="muted">
                {f.assignedToName ? `${f.assignedToName}` : ''}
                {f.enquiryId && <> · <Link to={`/enquiries/${f.enquiryId}`}>{f.enquiryNo}</Link></>}
                {f.notes ? ` · ${f.notes}` : ''}
              </div>
            </div>
          </div>
        ))}
      </Section>

      <ClientSiteVisitsSection query={related} section={d?.siteVisits} />

      {d && <UnitsSection rows={d.units === null ? null : d.units?.rows ?? []} enquiries={d.enquiries?.rows ?? []} />}
    </>
  );
}
