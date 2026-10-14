import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClientMutations, useClients } from '../../api/clients';
import { useMasterOptions } from '../../api/masters';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Pill } from '../../components/ui/Pill';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { useToast } from '../../hooks/useToast';
import { formatDateFull } from '../../lib/format';
import { UnitsCell } from '../relations/UnitsCell';
import { ClientFormModal } from './ClientFormModal';
import './clients.css';

const FILTER_KEYS = ['categoryId', 'isArchived'];

/** Category pill that keeps showing a category even after it was deactivated (history). */
export function CategoryPill({ category }) {
  if (!category) return <span className="muted">—</span>;
  return <Pill label={category.isActive ? category.label : `${category.label} (inactive)`} size="sm" dot={Boolean(category.color)} color={category.color} bg={category.color ? `${category.color}22` : undefined} />;
}

export function ClientsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, dataScope, branchIds } = usePermissions();
  const table = useTableState({ defaultSort: '-createdAt', filterKeys: FILTER_KEYS });
  const query = useClients(table.params);
  const categories = useMasterOptions(['CLIENT_CATEGORY'], { includeInactive: false });
  const { archive } = useClientMutations();
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(null);
  const showBranch = dataScope === 'ALL' || branchIds.length > 1;

  const columns = [
    { key: 'clientNo', header: 'Client ID', sortable: true, render: (c) => <span className="id-chip">{c.clientNo}</span> },
    { key: 'personName', header: 'Name', sortable: true, render: (c) => <strong>{c.name}</strong> },
    { key: 'phone', header: 'Phone', render: (c) => c.phone },
    { key: 'category', header: 'Category', render: (c) => <CategoryPill category={c.category} /> },
    ...(showBranch ? [{ key: 'branch', header: 'Branch', render: (c) => c.branch?.name ?? '—' }] : []),
    ...(query.data?.rows?.some((r) => r.units !== undefined) ? [{ key: 'units', header: 'Units', wrap: true, minWidth: 230, render: (c) => <UnitsCell units={c.units} /> }] : []),
    { key: 'assignedToName', header: 'Assigned to', render: (c) => c.assignedToName ?? '—' },
    { key: 'createdAt', header: 'Created', sortable: true, render: (c) => formatDateFull(c.createdAt) },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Clients</h2>
        {can('clients.create') && <Button onClick={() => setCreating(true)}>New client</Button>}
      </div>
      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search name, phone or client ID" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Category" value={table.params.categoryId} onChange={(v) => table.setFilter('categoryId', v)} options={(categories.data?.CLIENT_CATEGORY ?? []).map((m) => ({ value: m._id, label: m.label }))} loading={categories.isPending} />
        <FilterSelect label="Status" value={table.params.isArchived} onChange={(v) => table.setFilter('isArchived', v)} options={[{ value: 'true', label: 'Archived' }]} allLabel="Active" />
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
        getRowId={(c) => c.id}
        onRowClick={(c) => navigate(`/clients/${c.id}`)}
        rowActions={(c) => (
          <ActionMenu
            items={[
              { label: 'View', onSelect: () => navigate(`/clients/${c.id}`) },
              { label: 'Archive', danger: true, hidden: !can('clients.archive') || c.isArchived, onSelect: () => setArchiving(c) },
            ]}
          />
        )}
        empty={{ title: table.hasActiveFilters ? 'No clients match' : 'No clients yet', description: table.hasActiveFilters ? 'Try clearing the search or filters.' : can('clients.create') ? 'Create the first client to get started.' : undefined }}
      />
      {creating && <ClientFormModal onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.name}?`}
        description="The client disappears from lists but its history is kept. The person can become a client of this branch again later."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(archiving.id);
          toast.success('Client archived');
        }}
      />
    </div>
  );
}
