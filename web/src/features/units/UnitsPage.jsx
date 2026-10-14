import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useMasterOptions } from '../../api/masters';
import { useUnitMutations, useUnits } from '../../api/units';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { useToast } from '../../hooks/useToast';
import { formatInr } from '../../lib/format';
import { UnitAssignDialog, UnitStatusDialog } from './UnitDialogs';
import { UnitFormModal } from './UnitFormModal';
import { UnitStatusPill } from './UnitStatusPill';
import './units.css';

const FILTER_KEYS = ['statusId', 'propertyTypeId', 'buildingTypeId', 'locationId', 'assignedTo', 'branchId', 'minPrice', 'maxPrice', 'isArchived'];

/** Price bounds are applied when the field loses focus or Enter is pressed, so typing does not fire a request per keystroke. */
function PriceFilter({ table }) {
  const commit = (key) => (e) => table.setFilter(key, e.target.value.trim());
  const onKey = (key) => (e) => e.key === 'Enter' && commit(key)(e);
  return (
    <span className="unit-price-filter">
      <input type="number" min="0" className="enq-date" aria-label="Minimum price" placeholder="Min ₹" key={`min-${table.params.minPrice ?? ''}`} defaultValue={table.params.minPrice ?? ''} onBlur={commit('minPrice')} onKeyDown={onKey('minPrice')} />
      <input type="number" min="0" className="enq-date" aria-label="Maximum price" placeholder="Max ₹" key={`max-${table.params.maxPrice ?? ''}`} defaultValue={table.params.maxPrice ?? ''} onBlur={commit('maxPrice')} onKeyDown={onKey('maxPrice')} />
    </span>
  );
}

export function UnitsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, dataScope, branchIds } = usePermissions();
  const table = useTableState({ defaultSort: '-createdAt', filterKeys: FILTER_KEYS });
  const list = useUnits(table.params);
  const masters = useMasterOptions(['UNIT_STATUS', 'PROPERTY_TYPE', 'BUILDING_TYPE']);
  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branchFilter = table.params.branchId || (multiBranch ? undefined : branchIds[0]);
  const locations = useMasterOptions(['LOCATION'], { branchId: branchFilter });
  const branches = useBranches({ limit: 100 });
  const users = useUsers({ isActive: 'true', limit: 100 }, { enabled: can('users.view') && dataScope !== 'OWN' });
  const { archive } = useUnitMutations();
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [statusFor, setStatusFor] = useState(null);
  const [archiving, setArchiving] = useState(null);

  const opt = (type, source = masters) => (source.data?.[type] ?? []).map((m) => ({ value: m._id, label: m.label }));

  const columns = [
    { key: 'cover', header: '', render: (u) => (u.coverUrl ? <img className="unit-thumb" src={u.coverUrl} alt="" loading="lazy" /> : <span className="unit-thumb-empty" aria-hidden="true" />) },
    { key: 'unitCode', header: 'Unit ID', sortable: true, render: (u) => <span className="id-chip">{u.unitCode}</span> },
    { key: 'name', header: 'Name', sortable: true, render: (u) => <strong>{u.name}</strong> },
    { key: 'propertyType', header: 'Property type', render: (u) => u.propertyType?.label ?? '—' },
    { key: 'buildingType', header: 'Building type', render: (u) => u.buildingType?.label ?? '—' },
    { key: 'location', header: 'Location', render: (u) => u.location?.label ?? '—' },
    { key: 'builtUpArea', header: 'Built-up (sq ft)', sortable: true, render: (u) => (u.builtUpArea != null ? u.builtUpArea.toLocaleString('en-IN') : '—') },
    { key: 'expectedPrice', header: 'Expected price', sortable: true, render: (u) => (u.expectedPrice != null ? formatInr(u.expectedPrice) : '—') },
    { key: 'statusChangedAt', header: 'Status', sortable: true, render: (u) => <UnitStatusPill unit={u} /> },
    { key: 'assignedToName', header: 'Salesperson', render: (u) => u.assignedToName ?? 'Unassigned' },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Units / Properties</h2>
        <div className="detail-actions">{can('units.create') && <Button onClick={() => setCreating(true)}>New unit</Button>}</div>
      </div>

      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search unit ID, name, address or city" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Status" value={table.params.statusId} onChange={(v) => table.setFilter('statusId', v)} options={opt('UNIT_STATUS')} loading={masters.isPending} />
        <FilterSelect label="Property type" value={table.params.propertyTypeId} onChange={(v) => table.setFilter('propertyTypeId', v)} options={opt('PROPERTY_TYPE')} loading={masters.isPending} />
        <FilterSelect label="Building type" value={table.params.buildingTypeId} onChange={(v) => table.setFilter('buildingTypeId', v)} options={opt('BUILDING_TYPE')} loading={masters.isPending} />
        <FilterSelect label="Location" value={table.params.locationId} onChange={(v) => table.setFilter('locationId', v)} options={opt('LOCATION', locations)} loading={locations.isPending} />
        {users.data && <FilterSelect label="Salesperson" value={table.params.assignedTo} onChange={(v) => table.setFilter('assignedTo', v)} options={[{ value: 'unassigned', label: 'Unassigned' }, ...users.data.rows.map((u) => ({ value: u.id, label: u.name }))]} />}
        {multiBranch && <FilterSelect label="Branch" value={table.params.branchId} onChange={(v) => table.setFilter('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
        <PriceFilter table={table} />
        <FilterSelect label="Archive" value={table.params.isArchived} onChange={(v) => table.setFilter('isArchived', v)} options={[{ value: 'true', label: 'Archived' }]} allLabel="Active" />
      </FilterBar>

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
        getRowId={(u) => u.id}
        onRowClick={(u) => navigate(`/units/${u.id}`)}
        rowActions={(u) => (
          <ActionMenu
            items={[
              { label: 'Open', onSelect: () => navigate(`/units/${u.id}`) },
              { label: u.assignedTo ? 'Reassign' : 'Assign', hidden: !u.allowed.assign, onSelect: () => setAssigning(u) },
              { label: 'Change status…', hidden: !u.allowed.changeStatus, onSelect: () => setStatusFor(u) },
              { label: 'Archive', danger: true, hidden: !u.allowed.archive, onSelect: () => setArchiving(u) },
            ]}
          />
        )}
        empty={{ title: table.hasActiveFilters ? 'No units match' : 'No units yet', description: table.hasActiveFilters ? 'Try clearing the search or filters.' : can('units.create') ? 'Create the first unit to get started.' : undefined }}
      />

      {creating && <UnitFormModal onClose={() => setCreating(false)} />}
      {assigning && <UnitAssignDialog unit={assigning} onClose={() => setAssigning(null)} />}
      {statusFor && <UnitStatusDialog unit={statusFor} onClose={() => setStatusFor(null)} />}
      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.unitCode}?`}
        description="The unit disappears from lists, but its history is kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(archiving.id);
          toast.success('Unit archived');
        }}
      />
    </div>
  );
}
