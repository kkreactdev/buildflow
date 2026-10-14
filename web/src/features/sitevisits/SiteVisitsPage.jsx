import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useMasterOptions } from '../../api/masters';
import { useSiteVisits } from '../../api/sitevisits';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Segmented';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { formatWhen } from '../followups/datetime';
import { SiteVisitCalendar } from './SiteVisitCalendar';
import { SiteVisitFormModal } from './SiteVisitFormModal';
import { useVisitActions } from './useVisitActions';
import { VisitStatusPill } from './VisitStatusPill';
import '../enquiries/enquiries.css';
import './sitevisits.css';
import './sitevisits-calendar.css';

const FILTER_KEYS = ['view', 'status', 'assignedTo', 'branchId', 'from', 'to', 'isArchived'];
const VIEWS = [{ value: 'today', label: 'Today' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'overdue', label: 'Needs update' }, { value: 'all', label: 'All' }];
const LAYOUTS = [{ value: 'list', label: 'List' }, { value: 'calendar', label: 'Calendar' }];

/** Site visits. The tabs, filters, search, sorting and paging are all server-side; statuses come from the master. */
export function SiteVisitsPage() {
  const navigate = useNavigate();
  const { can, dataScope, branchIds } = usePermissions();
  const table = useTableState({ defaultSort: 'scheduledAt', filterKeys: FILTER_KEYS });
  const [layout, setLayout] = useState('list'); // 'list' | 'calendar'
  const tab = ['upcoming', 'overdue', 'all'].includes(table.params.view) ? table.params.view : 'today';
  // The calendar uses a wider window than the list tab's `view`, so it ignores the `view` filter
  // and keeps every other filter (status, assignedTo, branchId, isArchived) — the picker is
  // the same shape, the only thing that changes is the date range.
  const calendarFilters = { status: table.params.status, assignedTo: table.params.assignedTo, branchId: table.params.branchId, isArchived: table.params.isArchived };
  const query = useSiteVisits({ ...table.params, view: tab === 'all' ? undefined : tab });
  const masters = useMasterOptions(['SITEVISIT_STATUS']);
  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branches = useBranches({ limit: 100 });
  const users = useUsers({ isActive: 'true', limit: 100 }, { enabled: can('users.view') && dataScope !== 'OWN' });
  const actions = useVisitActions();
  const [scheduling, setScheduling] = useState(false);

  const columns = [
    { key: 'visitNo', header: 'Visit ID', sortable: true, render: (v) => <span className="id-chip">{v.visitNo}</span> },
    { key: 'scheduledAt', header: 'When', sortable: true, render: (v) => formatWhen(v.scheduledAt) },
    { key: 'personName', header: 'Person', sortable: true, render: (v) => <strong>{v.name}</strong> },
    { key: 'enquiry', header: 'Enquiry', render: (v) => <Link to={`/enquiries/${v.enquiryId}`} onClick={(e) => e.stopPropagation()}>{v.enquiryNo}</Link> },
    { key: 'units', header: 'Units', render: (v) => (v.units.length ? v.units.map((u) => u.unitCode).join(', ') : '—') },
    { key: 'status', header: 'Status', render: (v) => <VisitStatusPill visit={v} /> },
    { key: 'assignedToName', header: 'Visit by', render: (v) => v.assignedToName ?? '—' },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Site Visits</h2>
        <div className="detail-actions">{can('sitevisits.create') && can('enquiries.view') && <Button onClick={() => setScheduling(true)}>Schedule visit</Button>}</div>
      </div>
      <div className="enq-toolbar">
        <Segmented options={VIEWS} value={tab} onChange={(v) => table.setFilter('view', v === 'today' ? '' : v)} aria-label="Visit view" disabled={layout === 'calendar'} />
        <div className="enq-toolbar-spacer" />
        <Segmented options={LAYOUTS} value={layout} onChange={setLayout} aria-label="Site visits layout" />
      </div>

      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search visit ID, person, phone, enquiry or unit" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Status" value={table.params.status} onChange={(v) => table.setFilter('status', v)} options={(masters.data?.SITEVISIT_STATUS ?? []).map((m) => ({ value: m.code, label: m.label }))} loading={masters.isPending} />
        {users.data && <FilterSelect label="Visit by" value={table.params.assignedTo} onChange={(v) => table.setFilter('assignedTo', v)} options={users.data.rows.map((u) => ({ value: u.id, label: u.name }))} />}
        {multiBranch && <FilterSelect label="Branch" value={table.params.branchId} onChange={(v) => table.setFilter('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
        <input type="date" className="enq-date" aria-label="From date" value={table.params.from ?? ''} onChange={(e) => table.setFilter('from', e.target.value)} />
        <input type="date" className="enq-date" aria-label="To date" value={table.params.to ?? ''} onChange={(e) => table.setFilter('to', e.target.value)} />
        <FilterSelect label="Archive" value={table.params.isArchived} onChange={(v) => table.setFilter('isArchived', v)} options={[{ value: 'true', label: 'Archived' }]} allLabel="Active" />
      </FilterBar>

      {layout === 'list' ? (
        <DataTable
          columns={columns}
          rows={query.data?.rows}
          meta={query.data?.meta}
          loading={query.isFetching}
          error={query.error}
          onRetry={query.refetch}
          sort={table.params.sort}
          onSortChange={table.setSort}
          onPageChange={table.setPage}
          getRowId={(v) => v.id}
          onRowClick={(v) => navigate(`/site-visits/${v.id}`)}
          rowActions={(v) => <ActionMenu items={[{ label: 'Open', onSelect: () => navigate(`/site-visits/${v.id}`) }, ...actions.menuItems(v)]} />}
          empty={{
            title: table.hasActiveFilters ? 'No visits match' : tab === 'today' ? 'No visits today' : tab === 'overdue' ? 'Nothing needs updating' : 'No site visits',
            description: table.hasActiveFilters ? 'Try clearing the search or filters.' : 'Schedule visits from an enquiry.',
          }}
        />
      ) : (
        <SiteVisitCalendar filters={calendarFilters} canCreate={can('sitevisits.create') && can('enquiries.view')} />
      )}
      {scheduling && <SiteVisitFormModal onClose={() => setScheduling(false)} onCreated={(v) => navigate(`/site-visits/${v.id}`)} />}
      {actions.element}
    </div>
  );
}
