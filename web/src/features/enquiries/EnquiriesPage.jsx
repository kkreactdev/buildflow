import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useEnquiries, useEnquiryMutations } from '../../api/enquiries';
import { api } from '../../api/http';
import { useMasterOptions, useWorkflowStages } from '../../api/masters';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Segmented } from '../../components/ui/Segmented';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { useToast } from '../../hooks/useToast';
import { formatDateFull } from '../../lib/format';
import { AssignDialog } from './AssignDialog';
import { EnquiryFormModal } from './EnquiryFormModal';
import { KanbanBoard } from './KanbanBoard';
import { UnitsCell } from '../relations/UnitsCell';
import { StageBadge } from './StageBadge';
import { MoveToDialog } from './MoveToDialog';
import { useStageMover } from './useStageMover';
import './enquiries.css';

const FILTER_KEYS = ['stage', 'sourceId', 'typeId', 'propertyTypeId', 'assignedTo', 'branchId', 'from', 'to', 'isArchived', 'view'];
const VIEWS = [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }];

/** Filters understood by the API (the view toggle is UI-only). */
function apiFilters(params) {
  const { view: _view, page: _page, limit: _limit, sort: _sort, ...filters } = params;
  return filters;
}

export function EnquiriesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, dataScope, branchIds } = usePermissions();
  const [searchParams] = useSearchParams();
  const table = useTableState({ defaultSort: '-createdAt', filterKeys: FILTER_KEYS });
  const view = table.params.view === 'board' ? 'board' : 'list';
  const filters = apiFilters(table.params);
  const list = useEnquiries(table.params, { enabled: view === 'list' });
  const stages = useWorkflowStages();
  const masters = useMasterOptions(['ENQUIRY_SOURCE', 'ENQUIRY_TYPE', 'PROPERTY_TYPE']);
  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branches = useBranches({ limit: 100 });
  const users = useUsers({ isActive: 'true', limit: 100 }, { enabled: can('users.view') && dataScope !== 'OWN' });
  const { archive } = useEnquiryMutations();
  const mover = useStageMover();
  const [creating, setCreating] = useState(() => can('enquiries.create') && searchParams.get('create') === '1');
  const [assigning, setAssigning] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [moveTo, setMoveTo] = useState(null);
  const [exporting, setExporting] = useState(false);

  const opt = (type) => (masters.data?.[type] ?? []).map((m) => ({ value: m._id, label: m.label }));

  async function doExport() {
    setExporting(true);
    try {
      await api.download('enquiries/export.csv', { query: filters, filename: 'enquiries.csv' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  }

  const columns = [
    { key: 'enquiryNo', header: 'Enquiry ID', sortable: true, render: (e) => <span className="id-chip">{e.enquiryNo}</span> },
    { key: 'personName', header: 'Person', sortable: true, render: (e) => <strong>{e.name}</strong> },
    { key: 'phone', header: 'Phone', render: (e) => e.phone },
    { key: 'source', header: 'Source', render: (e) => e.source?.label ?? '—' },
    { key: 'type', header: 'Type', render: (e) => e.type?.label ?? '—' },
    { key: 'property', header: 'Property type', render: (e) => e.propertyType?.label ?? '—' },
    ...(list.data?.rows?.some((r) => r.units !== undefined) ? [{ key: 'units', header: 'Units', wrap: true, minWidth: 230, render: (e) => <UnitsCell units={e.units} /> }] : []),
    { key: 'location', header: 'Location', render: (e) => e.location?.label ?? '—' },
    { key: 'assignedToName', header: 'Assigned to', render: (e) => e.assignedToName ?? 'Unassigned' },
    { key: 'stageChangedAt', header: 'Status', sortable: true, render: (e) => <StageBadge stage={e.stage} /> },
    { key: 'followUp', header: 'Next follow-up', render: () => <span className="muted" title="Follow-ups arrive in a later release">—</span> },
    { key: 'createdAt', header: 'Created', sortable: true, render: (e) => formatDateFull(e.createdAt) },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Enquiries</h2>
        <div className="detail-actions">
          <Segmented options={VIEWS} value={view} onChange={(v) => table.setFilter('view', v === 'board' ? 'board' : '')} aria-label="View" />
          {can('enquiries.export') && <Button variant="secondary" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>}
          {can('enquiries.create') && <Button onClick={() => setCreating(true)}>New enquiry</Button>}
        </div>
      </div>

      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search enquiry ID, name or phone" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Status" value={table.params.stage} onChange={(v) => table.setFilter('stage', v)} options={(stages.data ?? []).map((s) => ({ value: s.systemKey, label: s.label }))} loading={stages.isPending} />
        <FilterSelect label="Source" value={table.params.sourceId} onChange={(v) => table.setFilter('sourceId', v)} options={opt('ENQUIRY_SOURCE')} loading={masters.isPending} />
        <FilterSelect label="Type" value={table.params.typeId} onChange={(v) => table.setFilter('typeId', v)} options={opt('ENQUIRY_TYPE')} loading={masters.isPending} />
        <FilterSelect label="Property type" value={table.params.propertyTypeId} onChange={(v) => table.setFilter('propertyTypeId', v)} options={opt('PROPERTY_TYPE')} loading={masters.isPending} />
        {users.data && <FilterSelect label="Assignee" value={table.params.assignedTo} onChange={(v) => table.setFilter('assignedTo', v)} options={[{ value: 'unassigned', label: 'Unassigned' }, ...users.data.rows.map((u) => ({ value: u.id, label: u.name }))]} />}
        {multiBranch && <FilterSelect label="Branch" value={table.params.branchId} onChange={(v) => table.setFilter('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
        <input type="date" className="enq-date" aria-label="Created from" value={table.params.from ?? ''} onChange={(e) => table.setFilter('from', e.target.value)} />
        <input type="date" className="enq-date" aria-label="Created to" value={table.params.to ?? ''} onChange={(e) => table.setFilter('to', e.target.value)} />
        <FilterSelect label="Archive" value={table.params.isArchived} onChange={(v) => table.setFilter('isArchived', v)} options={[{ value: 'true', label: 'Archived' }]} allLabel="Active" />
      </FilterBar>

      {view === 'board' ? (
        <KanbanBoard params={filters} />
      ) : (
        <DataTable
          columns={columns}
          rows={list.data?.rows}
          meta={list.data?.meta}
          loading={list.isFetching}
          error={list.error}
          onRetry={list.refetch}
          sort={table.params.sort}
          onSortChange={table.setSort}
          onPageChange={table.setPage}
          getRowId={(e) => e.id}
          onRowClick={(e) => navigate(`/enquiries/${e.id}`)}
          rowActions={(e) => (
            <ActionMenu
              items={[
                { label: 'Open', onSelect: () => navigate(`/enquiries/${e.id}`) },
                { label: e.assignedTo ? 'Reassign' : 'Assign', hidden: !can('enquiries.assign') || e.isArchived, onSelect: () => setAssigning(e) },
                { label: 'Change status…', hidden: e.isArchived, onSelect: () => setMoveTo(e) },
                { label: 'Archive', danger: true, hidden: !can('enquiries.archive') || e.isArchived, onSelect: () => setArchiving(e) },
              ]}
            />
          )}
          empty={{ title: table.hasActiveFilters ? 'No enquiries match' : 'No enquiries yet', description: table.hasActiveFilters ? 'Try clearing the search or filters.' : can('enquiries.create') ? 'Create the first enquiry to get started.' : undefined }}
        />
      )}

      {creating && <EnquiryFormModal onClose={() => setCreating(false)} />}
      {assigning && <AssignDialog enquiry={assigning} onClose={() => setAssigning(null)} />}
      {moveTo && <MoveToDialog enquiry={moveTo} onClose={() => setMoveTo(null)} onPick={(t) => { const e = moveTo; setMoveTo(null); mover.requestMove(e, t); }} />}
      {mover.dialog}
      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.enquiryNo}?`}
        description="The enquiry disappears from lists and the board, but its history is kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(archiving.id);
          toast.success('Enquiry archived');
        }}
      />
    </div>
  );
}
