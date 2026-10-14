import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useWorkflowStages } from '../../api/masters';
import { downloadReport, useReport, useReportCatalog } from '../../api/reports';
import { FilterSelect } from '../../components/data/FilterBar';
import { QueryState } from '../../components/data/QueryState';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DonutPanel } from '../../components/charts/DonutPanel';
import { HBarChart } from '../../components/charts/HBarChart';
import { seriesColor } from '../../components/charts/palette';
import { Reveal } from '../../components/motion/Reveal';
import { ChartPanel } from '../../components/ui/ChartPanel';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusPill } from '../../components/ui/StatusPill';
import { STATUS_COLORS } from '../../lib/statusTones';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { Skeleton } from '../../components/ui/Skeleton';
import { AlertTriangleIcon, DownloadIcon, LockIcon } from '../../components/ui/icons';
import { useToast } from '../../hooks/useToast';
import { usePermissions } from '../../hooks/usePermissions';
import './reports.css';

/** Which filters each report's API understands (the server validates them again). */
const FILTERS = {
  enquiries: ['from', 'to', 'branchId', 'assignedTo', 'stage'],
  followups: ['from', 'to', 'branchId', 'assignedTo', 'view'],
  sitevisits: ['from', 'to', 'branchId', 'assignedTo', 'status'],
  units: ['branchId', 'assignedTo'],
  bookings: ['from', 'to', 'branchId', 'salespersonId', 'status'],
  referrals: ['from', 'to', 'branchId', 'assignedTo'],
  funnel: ['from', 'to', 'branchId', 'assignedTo'],
};
const FIXED = {
  followups: { view: [['open', 'Open'], ['today', 'Due today'], ['missed', 'Missed'], ['upcoming', 'Upcoming']] },
  sitevisits: { status: [['SCHEDULED', 'Scheduled'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled']] },
  bookings: { status: [['ACTIVE', 'Active'], ['RELEASED', 'Released']] },
};
const PAGE_SIZE = 25;

/**
 * Reports. Filtering, sorting, paging and totals are all computed by the API, which applies the same role / branch / ownership
 * scope as the module's own list; the CSV button downloads exactly the filtered set. Nothing here widens what the user can see.
 */
export function ReportsPage() {
  const { can, dataScope, branchIds } = usePermissions();
  const [sp, setSp] = useSearchParams();
  const catalog = useReportCatalog();
  const reports = catalog.data ?? [];
  const key = sp.get('report') && reports.some((r) => r.key === sp.get('report')) ? sp.get('report') : reports[0]?.key;
  const current = reports.find((r) => r.key === key);

  const filterKeys = FILTERS[key] ?? [];
  const params = { page: Number(sp.get('page')) || 1, limit: PAGE_SIZE };
  for (const f of filterKeys) if (sp.get(f)) params[f] = sp.get(f);

  const report = useReport(key, params);
  const set = (name, value) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(name, value);
      else next.delete(name);
      if (name !== 'page') next.delete('page');
      if (name === 'report') [...next.keys()].forEach((k) => !['report'].includes(k) && next.delete(k));
      return next;
    }, { replace: true });

  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branches = useBranches({ limit: 100 });
  const users = useUsers({ isActive: 'true', limit: 100 }, { enabled: can('users.view') && dataScope !== 'OWN' });
  const stages = useWorkflowStages();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadReport(key, params);
    } catch (err) {
      toast.error(err?.message ?? 'The export failed');
    } finally {
      setExporting(false);
    }
  }

  if (catalog.isPending) return <div role="status" aria-label="Loading reports"><Skeleton height={120} /></div>;
  if (catalog.isError) {
    return <EmptyState icon={<AlertTriangleIcon size={28} />} title="Could not load reports" description={catalog.error?.message} action={<Button variant="secondary" onClick={() => catalog.refetch()}>Try again</Button>} />;
  }
  if (reports.length === 0) return <EmptyState icon={<LockIcon size={28} />} title="No reports available" description="Your role does not include the records any report lists." />;

  const dateField = (name, label) => <label className="dash-date">{label} <input type="date" aria-label={`${label} date`} value={sp.get(name) ?? ''} onChange={(e) => set(name, e.target.value)} /></label>;
  const personOptions = (users.data?.rows ?? []).map((u) => ({ value: u.id, label: u.name }));

  return (
    <div className="reports">
      <PageHeader eyebrow="Analytics" title="Reports" subtitle="Filter, review and export your records. Every report follows your role, branch and ownership access."
        actions={current?.canExport && <Button onClick={exportCsv} disabled={exporting || !report.data} icon={<DownloadIcon size={15} />}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>} />
      <div className="report-tabs" role="tablist" aria-label="Report">
        {reports.map((r) => <button key={r.key} type="button" role="tab" aria-selected={r.key === key} className={`segmented-item ${r.key === key ? 'is-active' : ''}`} onClick={() => set('report', r.key)}>{r.label}</button>)}
      </div>
      {current && <p className="dash-muted report-desc">{current.description}{current.note ? ` ${current.note}` : ''}</p>}

      <div className="dash-filters report-filters" role="group" aria-label="Report filters">
        {filterKeys.includes('from') && dateField('from', 'From')}
        {filterKeys.includes('to') && dateField('to', 'To')}
        {filterKeys.includes('branchId') && multiBranch && <FilterSelect label="Branch" value={sp.get('branchId')} onChange={(v) => set('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
        {filterKeys.includes('assignedTo') && users.data && <FilterSelect label="Salesperson" value={sp.get('assignedTo')} onChange={(v) => set('assignedTo', v)} options={personOptions} />}
        {filterKeys.includes('salespersonId') && users.data && <FilterSelect label="Salesperson" value={sp.get('salespersonId')} onChange={(v) => set('salespersonId', v)} options={personOptions} />}
        {filterKeys.includes('stage') && stages.data && <FilterSelect label="Stage" value={sp.get('stage')} onChange={(v) => set('stage', v)} options={stages.data.map((s) => ({ value: s.systemKey, label: s.label }))} />}
        {Object.entries(FIXED[key] ?? {}).map(([name, opts]) => <FilterSelect key={name} label={name === 'view' ? 'View' : 'Status'} value={sp.get(name)} onChange={(v) => set(name, v)} options={opts.map(([value, label]) => ({ value, label }))} />)}
      </div>

      <div className="report-body">
        <QueryState query={report} isEmpty={(d) => d.rows.length === 0} empty={{ title: 'No records match', description: 'Try a different date range or clear a filter.' }}>
          {(d) => (d.kind === 'funnel' ? <FunnelReport data={d} /> : <ListReport data={d} page={params.page} onPage={(p) => set('page', p === 1 ? '' : String(p))} />)}
        </QueryState>
      </div>
    </div>
  );
}

/** Known fixed record states are shown as the shared status badge; every other value stays plain text. */
function Cell({ header, value }) {
  const text = String(value);
  if (!/^status$/i.test(header) || !STATUS_COLORS[text.toUpperCase()]) return text;
  return <StatusPill statusKey={text.toUpperCase()} label={text} />;
}

function ListReport({ data, page, onPage }) {
  const groups = data.summary.groups;
  return (
    <>
      <div className={`report-top ${groups.length > 1 ? 'has-chart' : ''}`}>
        <Reveal className="report-summary-card">
          <Card className="report-total">
            <p className="report-total-label">Matching records</p>
            <p className="report-total-value">{data.summary.total.toLocaleString('en-IN')}</p>
            <ul className="report-summary" aria-label="Summary">
              <li className="tone-teal"><strong>{data.summary.total.toLocaleString('en-IN')}</strong> records</li>
              {groups.slice(0, 6).map((g, i) => <li key={g.key} style={{ '--tone': seriesColor(i + 1), '--tone-2': seriesColor(i + 1) }}><strong>{g.count}</strong> {g.label}</li>)}
            </ul>
          </Card>
        </Reveal>
        {groups.length > 1 && (
          <Reveal index={1} className="report-chart-card">
            <ChartPanel title="Breakdown" description="Across all matching records, not just this page.">
              <DonutPanel centerLabel="Records" size={150} data={groups.slice(0, 8).map((g, i) => ({ name: g.label, value: g.count, color: seriesColor(i + 1) }))} />
            </ChartPanel>
          </Reveal>
        )}
      </div>
      <Reveal index={2}>
        <Card padded={false} className="report-table-card">
          <div className="dash-scroll">
            <table className="dash-table report-table">
              <thead><tr>{data.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
              <tbody>{data.cells.map((row, i) => <tr key={data.rows[i]?.id ?? i}>{row.map((cell, j) => <td key={j}><Cell header={data.columns[j]} value={cell} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        </Card>
      </Reveal>
      <Pagination page={page} pageSize={data.meta.limit} totalCount={data.meta.total} totalPages={Math.max(1, Math.ceil(data.meta.total / data.meta.limit))} onPageChange={onPage} />
    </>
  );
}

function FunnelReport({ data }) {
  const f = data.funnel;
  return (
    <>
      <p className="report-explain" role="note"><strong>Two different measures.</strong> {f.definitions.current} {f.definitions.entered}</p>
      <Reveal>
        <ChartPanel title="Pipeline by stage" description={`In each stage now, and entered during ${f.range.from} to ${f.range.to}.`}>
          <HBarChart ariaLabel="Enquiries per workflow stage" series={[{ key: 'current', label: 'In stage now', color: '#0d9488' }, { key: 'entered', label: 'Entered during the period', color: '#7c3aed' }]}
            rows={f.stages.map((s) => ({ key: s.systemKey, label: s.label, values: { current: s.current, entered: s.entered } }))} />
        </ChartPanel>
      </Reveal>
      <Card padded={false} className="report-table-card">
        <table className="dash-table report-table">
          <thead><tr><th scope="col">Stage</th><th scope="col">In stage now</th><th scope="col">Entered during the period ({f.range.from} to {f.range.to})</th></tr></thead>
          <tbody>{f.stages.map((s) => <tr key={s.systemKey}><th scope="row">{s.label}</th><td>{s.current}</td><td>{s.entered}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
