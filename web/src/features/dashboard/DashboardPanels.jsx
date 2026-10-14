import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FunnelChart } from '../../components/charts/FunnelChart';
import { Segmented } from '../../components/ui/Segmented';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { DonutPanel } from '../../components/charts/DonutPanel';
import { HBarChart } from '../../components/charts/HBarChart';
import { seriesColor } from '../../components/charts/palette';
import { ChartPanel } from '../../components/ui/ChartPanel';
import { Pill } from '../../components/ui/Pill';
import { statusColor } from '../../lib/statusTones';
import { formatWhen } from '../followups/datetime';


/**
 * The enquiry funnel, from the configured workflow (rename, reorder or add a stage and it follows). Two separate measures, never
 * rates: how many enquiries are in each stage NOW (a snapshot, ignores the dates) or how many ENTERED it in the period (from the
 * stage history). The "lost" stage is shown beside the funnel, not inside it. `scope` carries the branch / salesperson filters
 * into the list link; the list page applies the user's permissions again.
 */
export function FunnelCard({ query, scope = {} }) {
  const [measure, setMeasure] = useState('current');
  const stages = query.data?.stages ?? [];
  const flow = stages.filter((s) => s.kind !== 'LOST');
  const lost = stages.filter((s) => s.kind === 'LOST');
  const to = (s) => {
    if (measure !== 'current') return undefined; // "entered" has no equivalent list filter
    const sp = new URLSearchParams({ stage: s.systemKey });
    for (const [k, v] of Object.entries(scope)) if (v) sp.set(k, v);
    return `/enquiries?${sp}`;
  };
  const defs = query.data?.definitions;
  return (
    <ChartPanel title="Enquiry funnel" description={measure === 'current' ? 'Enquiries in each stage right now.' : 'Enquiries that entered each stage in the period.'} query={query} isEmpty={query.data && stages.length === 0} emptyTitle="No stages configured"
      definition={defs ? `${defs.current} ${defs.entered}` : undefined}
      actions={<Segmented aria-label="Funnel measure" value={measure} onChange={setMeasure} options={[{ value: 'current', label: 'In stage now' }, { value: 'entered', label: 'Entered in period' }]} />}>
      {query.data && (
        <>
          <FunnelChart ariaLabel="Enquiries per workflow stage" stages={flow.map((s) => ({ key: s.systemKey, label: s.label, value: s[measure], to: to(s) }))} />
          {lost.length > 0 && (
            <p className="funnel-lost">{lost.map((s) => `${s.label}: ${s[measure].toLocaleString('en-IN')}`).join(' · ')} <span className="dash-muted">(not part of the funnel)</span></p>
          )}
          <div className="visually-hidden"><table>
            <caption>Enquiry funnel</caption>
            <thead><tr><th scope="col">Stage</th><th scope="col">In stage now</th><th scope="col">Entered during the period</th></tr></thead>
            <tbody>{stages.map((s) => <tr key={s.systemKey}><th scope="row">{s.label}</th><td>{s.current}</td><td>{s.entered}</td></tr>)}</tbody>
          </table></div>
          <p className="dash-muted dash-def">{defs.current} {defs.entered}</p>
        </>
      )}
    </ChartPanel>
  );
}

export function SourcesCard({ query }) {
  const rows = query.data?.rows ?? [];
  return (
    <ChartPanel title="Enquiry sources" description="Where the enquiries created in the period came from." query={query} isEmpty={query.data && rows.length === 0} emptyTitle="No enquiries in this period" definition={query.data?.definition}>
      <DonutPanel centerLabel="Enquiries" data={rows.map((r, i) => ({ name: r.source?.label ?? 'No source', value: r.created, color: seriesColor(i) }))} />
      <div className="visually-hidden"><table>
        <caption>Enquiry sources</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">Created</th><th scope="col">Booked or beyond now</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.sourceId ?? 'none'}><th scope="row">{r.source?.label ?? 'No source'}</th><td>{r.created}</td><td>{r.bookedOrBeyond}</td></tr>)}</tbody>
      </table></div>
    </ChartPanel>
  );
}

/**
 * Units by their CURRENT status (a snapshot of non-archived units): the date range does not apply, the branch / salesperson
 * filters and the user's scope do. Segments come from the unit-status masters, coloured by the shared status colours.
 */
export function InventoryCard({ units, defs, to }) {
  const data = units.byStatus.map((s, i) => ({ name: s.status?.label ?? s.statusKey, value: s.count, color: statusColor(s.statusKey, undefined) ?? seriesColor(i + 3), to: to?.(s.statusId) }));
  return (
    <ChartPanel title="Unit inventory" description="Units by current status. A snapshot: the date range does not apply." definition={defs.units} isEmpty={units.total === 0} emptyTitle="No units yet">
      <DonutPanel centerLabel="Units" data={data} size={216} />
    </ChartPanel>
  );
}

export function BookingsCard({ bookings, prev, defs }) {
  return (
    <ChartPanel title="Booking overview" description="Active now, and made / released in the period." definition={defs.activeBookings}
      isEmpty={bookings.active + bookings.made.value + bookings.released.value === 0} emptyTitle="No bookings yet">
      <ColumnChart ariaLabel="Bookings" items={[
        { key: 'active', label: 'Active now', value: bookings.active, color: statusColor('ACTIVE') },
        { key: 'made', label: 'Made in period', value: bookings.made.value, color: '#2563eb' },
        { key: 'released', label: 'Released in period', value: bookings.released.value, color: statusColor('RELEASED') },
      ]} />
      <p className="dash-muted dash-def">Previous period ({prev}): {bookings.made.previous} made, {bookings.released.previous} released.</p>
    </ChartPanel>
  );
}

export function WorkloadCard({ followUps, siteVisits }) {
  const items = [
    followUps && { key: 'f-today', label: 'Follow-ups today', value: followUps.today, color: statusColor('PENDING') },
    followUps && { key: 'f-missed', label: 'Missed follow-ups', value: followUps.missed, color: statusColor('MISSED') },
    followUps && { key: 'f-up', label: 'Upcoming follow-ups', value: followUps.upcoming, color: '#f59e0b' },
    siteVisits && { key: 'v-today', label: 'Visits today', value: siteVisits.today, color: '#2563eb' },
    siteVisits && { key: 'v-up', label: 'Upcoming visits', value: siteVisits.upcoming, color: '#0891b2' },
    siteVisits && { key: 'v-over', label: 'Overdue visits', value: siteVisits.overdue, color: '#ef4444' },
  ].filter(Boolean);
  return (
    <ChartPanel title="Follow-up and visit workload" description="What needs attention, right now." isEmpty={items.every((i) => i.value === 0)} emptyTitle="Nothing scheduled">
      <ColumnChart ariaLabel="Follow-up and visit workload" items={items} />
    </ChartPanel>
  );
}

const COLUMNS = [['newEnquiries', 'New enquiries', '#0d9488'], ['bookingsMade', 'Bookings made', '#2563eb'], ['visitsCompleted', 'Visits completed', '#7c3aed'], ['missedFollowUps', 'Missed follow-ups now', '#dc2626']];

export function PerformanceCard({ query }) {
  if (query.isError && query.error?.status === 403) return null;
  const cols = query.data ? COLUMNS.filter(([k]) => query.data.columns[k]) : [];
  return (
    <ChartPanel title="Team performance" description="Per person over the period; only people and records you can see." query={query} isEmpty={query.data && query.data.rows.length === 0} emptyTitle="No activity in this period" definition={query.data?.definition} className="panel-wide">
      {query.data && (
        <>
          <HBarChart ariaLabel="Team performance" series={cols.map(([key, label, color]) => ({ key, label, color }))} rows={query.data.rows.map((r) => ({ key: r.userId ?? 'none', label: r.name, values: r }))} />
          <div className="dash-scroll">
            <div className="visually-hidden"><table>
              <caption>Team performance</caption>
              <thead><tr><th scope="col">Person</th>{cols.map(([k, label]) => <th key={k} scope="col">{label}</th>)}</tr></thead>
              <tbody>{query.data.rows.map((r) => <tr key={r.userId ?? 'none'}><th scope="row">{r.name}</th>{cols.map(([k]) => <td key={k}>{r[k]}</td>)}</tr>)}</tbody>
            </table></div>
          </div>
        </>
      )}
    </ChartPanel>
  );
}

/** A short list of the next few records, each linking to its own page. */
export function ListCard({ title, description, query, empty, row, to, toLabel }) {
  const rows = query.data?.rows ?? [];
  return (
    <ChartPanel title={title} description={description} query={query} isEmpty={query.data && rows.length === 0} emptyTitle={empty}
      actions={to && <Link to={to} className="panel-link">{toLabel ?? 'View all'}</Link>}>
      <ul className="mini-list">{rows.map((r) => <li key={r.id}>{row(r)}</li>)}</ul>
    </ChartPanel>
  );
}

export function ActivityTimeline({ items, link }) {
  return (
    <ul className="timeline-list">
      {items.map((a) => {
        const to = link(a.refs);
        return (
          <li key={a.id}>
            <span className="tl-dot" aria-hidden="true" />
            <div>
              <span>{to ? <Link to={to}>{a.description}</Link> : a.description}</span>
              <time className="dash-muted" dateTime={a.at}>{a.byName ? `${a.byName} · ` : ''}{formatWhen(a.at)}</time>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export { Pill };
