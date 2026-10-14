import { Link, useSearchParams } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useDashboardFunnel, useDashboardPerformance, useDashboardSources, useDashboardSummary } from '../../api/dashboard';
import { useFollowUps } from '../../api/followups';
import { useSiteVisits } from '../../api/sitevisits';
import { FilterSelect } from '../../components/data/FilterBar';
import { Reveal } from '../../components/motion/Reveal';
import { Button } from '../../components/ui/Button';
import { ChartPanel } from '../../components/ui/ChartPanel';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { AlertTriangleIcon, CheckIcon, FileTextIcon, FollowUpIcon, LeadsIcon, LinkIcon, LocationPinIcon, LockIcon, PersonAddIcon, PipelineIcon, PlusIcon } from '../../components/ui/icons';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { formatWhen } from '../followups/datetime';
import { notificationTarget } from '../notifications/notificationLinks';
import { ActivityTimeline, BookingsCard, FunnelCard, InventoryCard, ListCard, PerformanceCard, SourcesCard, WorkloadCard } from './DashboardPanels';
import { Kpi, KpiGrid, NoAccess } from './Kpi';
import { addDays, dayIn, formatDay, greeting, hourIn } from './greeting';
import './dashboard.css';

const FILTER_KEYS = ['from', 'to', 'branchId', 'assignedTo'];
const PRESETS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']];

/** Appends only the filters that the target list page understands, so a card opens the matching records (and nothing the user cannot see). */
const link = (path, params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
};

/**
 * The operational dashboard. Every number comes from the server already scoped to the caller's role (all / branch / own);
 * the filters here can only narrow it. A section the user may not view is replaced by a notice, never shown as zero.
 */
export function DashboardPage() {
  const { can, dataScope, branchIds } = usePermissions();
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? '']).filter(([, v]) => v));
  const set = (key, value) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });

  const summary = useDashboardSummary(filters);
  const data = summary.data;
  const allowed = data?.allowed ?? {};
  const funnel = useDashboardFunnel(filters, Boolean(allowed.enquiries));
  const sources = useDashboardSources(filters, Boolean(allowed.enquiries));
  const performance = useDashboardPerformance(filters, Boolean(data) && dataScope !== 'OWN');
  const narrowing = { branchId: filters.branchId, assignedTo: filters.assignedTo };
  const nextFollowUps = useFollowUps({ view: 'upcoming', limit: 5, sort: 'scheduledAt', ...narrowing }, { enabled: Boolean(allowed.followUps) });
  const missedFollowUps = useFollowUps({ view: 'missed', limit: 5, sort: 'scheduledAt', ...narrowing }, { enabled: Boolean(allowed.followUps) });
  const nextVisits = useSiteVisits({ view: 'upcoming', limit: 5, sort: 'scheduledAt', ...narrowing }, { enabled: Boolean(allowed.siteVisits) });
  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branches = useBranches({ limit: 100 });
  const users = useUsers({ isActive: 'true', limit: 100 }, { enabled: can('users.view') && dataScope !== 'OWN' });
  const reset = FILTER_KEYS.some((k) => sp.get(k));

  const preset = (days) => {
    const today = dayIn(data?.range.timeZone ?? 'Asia/Kolkata');
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set('from', addDays(today, -(days - 1)));
      next.set('to', today);
      return next;
    }, { replace: true });
  };

  const toolbar = (
    <div className="dash-filters" role="group" aria-label="Dashboard filters">
      <div className="dash-presets" role="group" aria-label="Date range presets">
        {PRESETS.map(([days, label]) => <button key={days} type="button" className={data?.range.days === days ? 'is-active' : ''} onClick={() => preset(days)}>{label}</button>)}
      </div>
      <label className="dash-date">From <input type="date" aria-label="From date" value={sp.get('from') ?? data?.range.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
      <label className="dash-date">To <input type="date" aria-label="To date" value={sp.get('to') ?? data?.range.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
      {multiBranch && <FilterSelect label="Branch" value={sp.get('branchId')} onChange={(v) => set('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
      {users.data && <FilterSelect label="Salesperson" value={sp.get('assignedTo')} onChange={(v) => set('assignedTo', v)} options={users.data.rows.map((u) => ({ value: u.id, label: u.name }))} />}
      {reset && <Button variant="ghost" onClick={() => setSp({}, { replace: true })}>Clear</Button>}
    </div>
  );

  // The page's own heading. The topbar names the product, not the page, so this is what tells a
  // screen-reader user which page they are on. Same markup as every other page, so it picks up the
  // shared `.page-header` styling rather than inventing its own.
  const heading = <div className="page-header"><h2>Dashboard</h2></div>;

  const firstName = (user?.name ?? '').split(/\s+/)[0];
  const hero = (
    <section className="dash-hero" aria-label="Welcome">
      <div>
        <h2>{greeting(hourIn(data?.range.timeZone))}{firstName ? `, ${firstName}` : ''}</h2>
        <p>Here is how your enquiries, site visits, units and bookings are doing{data ? ` from ${formatDay(data.range.from)} to ${formatDay(data.range.to)}` : ''}.</p>
      </div>
      {toolbar}
    </section>
  );

  if (summary.isPending) {
    return (
      <div className="dashboard">
        {heading}
        {hero}
        <div className="kpi-grid" data-cols="4" role="status" aria-label="Loading dashboard">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={112} />)}</div>
      </div>
    );
  }
  if (summary.isError) {
    const denied = summary.error?.status === 403;
    return (
      <div className="dashboard">
        {heading}
        {denied
          ? <EmptyState icon={<LockIcon size={28} />} title="You don't have access to the dashboard" description="Ask an administrator to grant the dashboard permission." />
          : <>
              {hero}
              <EmptyState icon={<AlertTriangleIcon size={28} />} title="Could not load the dashboard" description={summary.error?.message} action={<Button variant="secondary" onClick={() => summary.refetch()}>Try again</Button>} />
            </>}
      </div>
    );
  }

  const { range, definitions: defs, enquiries, followUps, siteVisits, units, bookings, clients, referrals, activities } = data;
  const prev = `the previous ${range.days} day${range.days === 1 ? '' : 's'}`;
  const scope = { branchId: filters.branchId, assignedTo: filters.assignedTo };
  const period = { from: range.from, to: range.to };
  const nothing = !enquiries && !followUps && !siteVisits && !units && !bookings && !clients && !referrals;
  const quick = [
    can('enquiries.create') && { to: '/enquiries?create=1', label: 'New enquiry', icon: PlusIcon, tone: 'teal' },
    allowed.followUps && { to: '/follow-ups', label: 'Follow-ups', icon: FollowUpIcon, tone: 'amber' },
    allowed.siteVisits && { to: '/site-visits', label: 'Site visits', icon: LocationPinIcon, tone: 'blue' },
    allowed.bookings && { to: '/bookings', label: 'Bookings', icon: FileTextIcon, tone: 'violet' },
  ].filter(Boolean);

  return (
    <div className="dashboard">
      {heading}
      {hero}
      <p className="dash-range" data-testid="dash-range">
        {range.from} to {range.to} ({range.days} day{range.days === 1 ? '' : 's'}, {range.timeZone}) · compared with {prev}
        {summary.isFetching && <span className="dash-refreshing"> · updating…</span>}
      </p>

      {quick.length > 0 && (
        <Reveal>
          <nav className="quick-actions" aria-label="Quick actions">
            {quick.map((q) => { const Icon = q.icon; return <Link key={q.to} to={q.to} className={`quick tone-${q.tone}`}><span><Icon size={16} /></span>{q.label}</Link>; })}
          </nav>
        </Reveal>
      )}

      {nothing && <EmptyState icon={<LockIcon size={28} />} title="Nothing to show yet" description="Your role does not include any of the records the dashboard summarises." />}

      <section aria-labelledby="dash-enquiries">
        <h3 id="dash-enquiries">Enquiries</h3>
        {enquiries ? (
          <KpiGrid>
            <Kpi index={0} tone="blue" icon={LeadsIcon} featured label="New enquiries" value={enquiries.new.value} previous={enquiries.new.previous} prevLabel={prev} definition={defs.newEnquiries} to={link('/enquiries', { ...scope, ...period })} />
            <Kpi index={1} tone="amber" icon={PipelineIcon} label="Active enquiries" value={enquiries.active} definition={defs.activeEnquiries} to={link('/enquiries', scope)} />
            <Kpi index={2} tone="green" icon={CheckIcon} label="Converted enquiries" value={enquiries.converted.value} previous={enquiries.converted.previous} prevLabel={prev} note={`${enquiries.converted.current} in the converted stage now`} definition={defs.convertedEnquiries} to={link('/enquiries', scope)} />
          </KpiGrid>
        ) : <NoAccess what="enquiries" />}
      </section>

      <section aria-labelledby="dash-work">
        <h3 id="dash-work">Follow-ups and site visits</h3>
        <KpiGrid>
          {followUps ? (
            <>
              <Kpi index={0} tone="amber" icon={FollowUpIcon} label="Follow-ups today" value={followUps.today} definition={defs.followUpsToday} to={link('/follow-ups', { ...scope, view: 'today' })} />
              <Kpi index={1} tone="coral" icon={AlertTriangleIcon} label="Missed follow-ups" value={followUps.missed} definition={defs.followUpsMissed} to={link('/follow-ups', { ...scope, view: 'missed' })} />
              <Kpi index={2} tone="amber" icon={FollowUpIcon} label="Upcoming follow-ups" value={followUps.upcoming} to={link('/follow-ups', { ...scope, view: 'upcoming' })} />
            </>
          ) : <NoAccess what="follow-ups" />}
          {siteVisits ? (
            <>
              <Kpi index={3} tone="blue" icon={LocationPinIcon} label="Site visits today" value={siteVisits.today} definition={defs.siteVisitsToday} to={link('/site-visits', { ...scope, view: 'today' })} />
              <Kpi index={4} tone="sky" icon={LocationPinIcon} label="Upcoming site visits" value={siteVisits.upcoming} definition={defs.siteVisitsUpcoming} to={link('/site-visits', { ...scope, view: 'upcoming' })} />
              <Kpi index={5} tone="rose" icon={AlertTriangleIcon} label="Overdue site visits" value={siteVisits.overdue} definition={defs.siteVisitsOverdue} to={link('/site-visits', { ...scope, view: 'overdue' })} />
            </>
          ) : <NoAccess what="site visits" />}
        </KpiGrid>
      </section>

      <section aria-labelledby="dash-people">
        <h3 id="dash-people">Clients and referrals</h3>
        <KpiGrid>
          {clients ? <Kpi index={0} tone="cyan" icon={PersonAddIcon} label="New clients" value={clients.new.value} previous={clients.new.previous} prevLabel={prev} definition={defs.newClients} to={link('/clients', {})} /> : <NoAccess what="clients" />}
          {referrals ? <Kpi index={1} tone="violet" icon={LinkIcon} label="New referrals" value={referrals.new.value} previous={referrals.new.previous} prevLabel={prev} note={`${referrals.total} referrals in total`} definition={defs.newReferrals} to={link('/referrals', { ...scope, ...period })} /> : <NoAccess what="referrals" />}
        </KpiGrid>
      </section>

      <section aria-labelledby="dash-analytics">
        <h3 id="dash-analytics">Analytics</h3>
        <div className="dash-main">
          {allowed.enquiries && <Reveal><FunnelCard query={funnel} scope={scope} /></Reveal>}
          {units ? <Reveal index={1}><InventoryCard units={units} defs={defs} to={(statusId) => link('/units', { ...scope, statusId })} /></Reveal> : allowed.units === false && <Reveal index={1}><NoAccess what="units" /></Reveal>}
        </div>
        <div className="dash-grid dash-second">
          {allowed.enquiries && <Reveal className="span-4"><SourcesCard query={sources} /></Reveal>}
          {bookings ? <Reveal index={1} className="span-4"><BookingsCard bookings={bookings} prev={prev} defs={defs} /></Reveal> : allowed.bookings === false && <Reveal index={1} className="span-4"><NoAccess what="bookings" /></Reveal>}
          {(followUps || siteVisits) && <Reveal index={2} className="span-4"><WorkloadCard followUps={followUps} siteVisits={siteVisits} /></Reveal>}
        </div>
        {dataScope !== 'OWN' && <Reveal className="dash-after"><PerformanceCard query={performance} /></Reveal>}
      </section>

      <section aria-labelledby="dash-next">
        <h3 id="dash-next">What is coming up</h3>
        <div className="dash-grid">
          {allowed.followUps && (
            <Reveal className="span-6">
              <ListCard title="Upcoming follow-ups" description="The next five scheduled." query={nextFollowUps} empty="No upcoming follow-ups" to={link('/follow-ups', { ...scope, view: 'upcoming' })}
                row={(f) => <><div><strong>{f.name}</strong><span className="dash-muted">{f.type?.label ?? 'Follow-up'}</span></div><time className="dash-muted">{formatWhen(f.scheduledAt)}</time></>} />
            </Reveal>
          )}
          {allowed.followUps && (
            <Reveal index={1} className="span-6">
              <ListCard title="Missed follow-ups" description="Oldest first." query={missedFollowUps} empty="Nothing missed" to={link('/follow-ups', { ...scope, view: 'missed' })}
                row={(f) => <><div><strong>{f.name}</strong><span className="dash-muted">{f.type?.label ?? 'Follow-up'}</span></div><time className="dash-missed">{formatWhen(f.scheduledAt)}</time></>} />
            </Reveal>
          )}
          {allowed.siteVisits && (
            <Reveal className="span-6">
              <ListCard title="Upcoming site visits" description="The next five scheduled." query={nextVisits} empty="No upcoming site visits" to={link('/site-visits', { ...scope, view: 'upcoming' })}
                row={(v) => <><div><strong>{v.name}</strong><span className="dash-muted">{v.units?.length ? v.units.map((u) => u.unitCode).join(', ') : v.enquiryNo}</span></div><time className="dash-muted">{formatWhen(v.scheduledAt)}</time></>} />
            </Reveal>
          )}
          <Reveal index={1} className="span-6">
            <ChartPanel title="Recent activity" description="The latest actions you are allowed to see.">
              {activities === undefined ? <NoAccess what="activity" /> : activities.length === 0 ? <p className="dash-muted">No recent activity.</p> : <ActivityTimeline items={activities} link={notificationTarget} />}
            </ChartPanel>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
