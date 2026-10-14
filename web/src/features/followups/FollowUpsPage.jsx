import { Link } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useFollowUpSummary, useFollowUps } from '../../api/followups';
import { useMasterOptions } from '../../api/masters';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Segmented } from '../../components/ui/Segmented';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { formatWhen } from './datetime';
import { StatusPill } from './FollowUpsSection';
import { useFollowUpActions } from './useFollowUpActions';
import './followups.css';

const FILTER_KEYS = ['view', 'status', 'typeId', 'assignedTo', 'branchId', 'isArchived'];
const VIEWS = ['today', 'missed', 'upcoming'];

/**
 * Follow-ups. Tabs are Today / Missed / Upcoming / All with live counts from the server (`/followups/summary`),
 * so the numbers match what the lists will show. Statuses and types come from masters; nothing is hard-coded.
 */
export function FollowUpsPage() {
  const { dataScope, branchIds, can } = usePermissions();
  const table = useTableState({ defaultSort: 'scheduledAt', filterKeys: FILTER_KEYS });
  const tab = VIEWS.includes(table.params.view) ? table.params.view : table.params.view === 'all' ? 'all' : 'today';
  const params = { ...table.params, view: tab === 'all' ? undefined : tab };
  const query = useFollowUps(params);
  const summary = useFollowUpSummary({ branchId: table.params.branchId, assignedTo: table.params.assignedTo });
  const masters = useMasterOptions(['FOLLOWUP_TYPE', 'FOLLOWUP_STATUS']);
  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branches = useBranches({ limit: 100 });
  const users = useUsers({ isActive: 'true', limit: 100 }, { enabled: can('users.view') && dataScope !== 'OWN' });
  const actions = useFollowUpActions();

  const s = summary.data;
  const count = (n) => (n === undefined ? '' : ` (${n})`);
  const options = [
    { value: 'today', label: `Today${count(s?.today)}` },
    { value: 'missed', label: `Missed${count(s?.missed)}` },
    { value: 'upcoming', label: `Upcoming${count(s?.upcoming)}` },
    { value: 'all', label: 'All' },
  ];
  const opt = (type, key = '_id') => (masters.data?.[type] ?? []).map((m) => ({ value: m[key], label: m.label }));

  const columns = [
    { key: 'scheduledAt', header: 'When', sortable: true, render: (f) => <span className={`fu-when ${f.statusKey === 'MISSED' ? 'fu-missed' : ''}`}>{formatWhen(f.scheduledAt)}</span> },
    { key: 'personName', header: 'Person', sortable: true, render: (f) => <strong>{f.name}</strong> },
    { key: 'phone', header: 'Phone', render: (f) => f.phone },
    {
      key: 'related',
      header: 'Related to',
      render: (f) =>
        f.enquiryId ? <Link to={`/enquiries/${f.enquiryId}`}>{f.enquiryNo}</Link>
          : f.clientId ? <Link to={`/clients/${f.clientId}`}>{f.clientNo}</Link>
            : f.sellerPropertyId ? <Link to={`/sellers/properties/${f.sellerPropertyId}`}>{f.sellerPropertyNo}</Link>
              : f.sellerId ? <Link to={`/sellers/${f.sellerId}`}>{f.sellerNo}</Link>
                : '—',
    },
    { key: 'type', header: 'Type', render: (f) => f.type?.label ?? '—' },
    { key: 'status', header: 'Status', render: (f) => <StatusPill followUp={f} /> },
    { key: 'assignedToName', header: 'Assigned to', render: (f) => f.assignedToName ?? '—' },
    { key: 'notes', header: 'Notes', wrap: true, render: (f) => f.notes ?? '—' },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Follow-ups</h2>
      </div>
      <div className="enq-toolbar">
        <Segmented options={options} value={tab} onChange={(v) => table.setFilter('view', v === 'today' ? '' : v)} aria-label="Follow-up view" />
      </div>
      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search person, phone or enquiry/client ID" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Type" value={table.params.typeId} onChange={(v) => table.setFilter('typeId', v)} options={opt('FOLLOWUP_TYPE')} loading={masters.isPending} />
        <FilterSelect label="Status" value={table.params.status} onChange={(v) => table.setFilter('status', v)} options={opt('FOLLOWUP_STATUS', 'code')} loading={masters.isPending} />
        {users.data && <FilterSelect label="Assignee" value={table.params.assignedTo} onChange={(v) => table.setFilter('assignedTo', v)} options={users.data.rows.map((u) => ({ value: u.id, label: u.name }))} />}
        {multiBranch && <FilterSelect label="Branch" value={table.params.branchId} onChange={(v) => table.setFilter('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
      </FilterBar>
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
        getRowId={(f) => f.id}
        rowActions={(f) => <ActionMenu items={actions.menuItems(f)} />}
        empty={{
          title: table.hasActiveFilters ? 'No follow-ups match' : tab === 'today' ? 'Nothing due today' : tab === 'missed' ? 'No missed follow-ups' : 'No follow-ups',
          description: table.hasActiveFilters ? 'Try clearing the search or filters.' : 'Schedule follow-ups from an enquiry or a client.',
        }}
      />
      {actions.element}
    </div>
  );
}
