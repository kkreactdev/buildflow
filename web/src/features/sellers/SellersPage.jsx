import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMasterOptions } from '../../api/masters';
import { useSellerMutations, useSellerProperties, useSellers } from '../../api/sellers';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { Segmented } from '../../components/ui/Segmented';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { useToast } from '../../hooks/useToast';
import { formatDateFull, formatInr, formatPhone } from '../../lib/format';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EligibilityPill, PropertyStatusPill, SellerStatusPill } from './SellerPills';
import { SellerCreateModal } from './SellerDialogs';
import '../clients/clients.css';
import './sellers.css';

const SELLER_FILTERS = ['statusKey', 'assignedTo', 'isArchived'];
const PROPERTY_FILTERS = ['statusKey', 'hasUnit'];

/**
 * Sellers and their proposed properties share one page, switched by the segmented control, because
 * the two are the same pipeline read two ways: by relationship, or by where each property has got to.
 * Both lists are server-filtered and server-paged; nothing is filtered in the browser.
 */
export function SellersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, dataScope, branchIds } = usePermissions();
  const [view, setView] = useState('sellers');

  const sellerTable = useTableState({ defaultSort: '-createdAt', filterKeys: SELLER_FILTERS });
  const propertyTable = useTableState({ defaultSort: '-createdAt', filterKeys: PROPERTY_FILTERS });
  const sellers = useSellers(sellerTable.params, { enabled: view === 'sellers' });
  const properties = useSellerProperties(propertyTable.params, { enabled: view === 'properties' });

  const sellerStatuses = useMasterOptions(['SELLER_STATUS'], { includeInactive: false });
  const propertyStatuses = useMasterOptions(['PROPERTY_STATUS'], { includeInactive: false });
  const { archive } = useSellerMutations();
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(null);
  const showBranch = dataScope === 'ALL' || branchIds.length > 1;

  const sellerColumns = [
    { key: 'sellerNo', header: 'Seller ID', sortable: true, render: (s) => <span className="id-chip">{s.sellerNo}</span> },
    { key: 'personName', header: 'Name', sortable: true, render: (s) => <strong>{s.personName}</strong> },
    { key: 'phoneE164', header: 'Phone', render: (s) => formatPhone(s.phoneE164) },
    { key: 'status', header: 'Status', render: (s) => <SellerStatusPill seller={s} /> },
    { key: 'propertyCount', header: 'Properties', render: (s) => (s.propertyCount > 0 ? `${s.propertyCount}${s.openPropertyCount ? ` (${s.openPropertyCount} open)` : ''}` : '—') },
    ...(showBranch ? [{ key: 'branch', header: 'Branch', render: (s) => s.branch?.name ?? '—' }] : []),
    { key: 'assignedToName', header: 'Handled by', render: (s) => s.assignedToName ?? <span className="muted">Unassigned</span> },
    { key: 'createdAt', header: 'Registered', sortable: true, render: (s) => formatDateFull(s.createdAt) },
  ];

  const propertyColumns = [
    { key: 'sellerPropertyNo', header: 'Property ID', sortable: true, render: (p) => <span className="id-chip">{p.sellerPropertyNo}</span> },
    { key: 'name', header: 'Property', sortable: true, render: (p) => <strong>{p.name}</strong> },
    { key: 'sellerName', header: 'Seller', render: (p) => p.sellerName ?? p.sellerNo },
    { key: 'status', header: 'Status', render: (p) => <PropertyStatusPill property={p} /> },
    { key: 'askingPrice', header: 'Asking', sortable: true, render: (p) => (p.askingPrice != null ? formatInr(p.askingPrice) : '—') },
    { key: 'unit', header: 'Unit', render: (p) => (p.unitCode ? <span className="id-chip">{p.unitCode}</span> : <span className="muted">Not created</span>) },
    { key: 'buyers', header: 'Buyers', render: (p) => <EligibilityPill property={p} /> },
    ...(showBranch ? [{ key: 'branch', header: 'Branch', render: (p) => p.branch?.name ?? '—' }] : []),
    { key: 'assignedToName', header: 'Handled by', render: (p) => p.assignedToName ?? <span className="muted">Unassigned</span> },
    { key: 'statusChangedAt', header: 'Last move', sortable: true, render: (p) => formatDateFull(p.statusChangedAt) },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Sellers</h2>
        {can('sellers.create') && <Button onClick={() => setCreating(true)}>Register seller</Button>}
      </div>

      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'sellers', label: 'Sellers' },
          { value: 'properties', label: 'Proposed properties' },
        ]}
      />

      {view === 'sellers' ? (
        <>
          <FilterBar search={sellerTable.params.search} onSearch={sellerTable.setSearch} searchPlaceholder="Search name, phone or seller ID" onReset={sellerTable.reset} canReset={sellerTable.hasActiveFilters}>
            <FilterSelect label="Status" value={sellerTable.params.statusKey} onChange={(v) => sellerTable.setFilter('statusKey', v)} options={(sellerStatuses.data?.SELLER_STATUS ?? []).map((m) => ({ value: m.systemKey, label: m.label }))} loading={sellerStatuses.isPending} />
            <FilterSelect label="Assignment" value={sellerTable.params.assignedTo} onChange={(v) => sellerTable.setFilter('assignedTo', v)} options={[{ value: 'unassigned', label: 'Unassigned' }]} allLabel="Anyone" />
            <FilterSelect label="Show" value={sellerTable.params.isArchived} onChange={(v) => sellerTable.setFilter('isArchived', v)} options={[{ value: 'true', label: 'Archived' }]} allLabel="Active" />
          </FilterBar>
          <DataTable
            columns={sellerColumns}
            rows={sellers.data?.rows}
            meta={sellers.data?.meta}
            loading={sellers.isFetching}
            error={sellers.error}
            onRetry={sellers.refetch}
            sort={sellerTable.params.sort}
            onSortChange={sellerTable.setSort}
            onPageChange={sellerTable.setPage}
            getRowId={(s) => s.id}
            onRowClick={(s) => navigate(`/sellers/${s.id}`)}
            rowActions={(s) => (
              <ActionMenu
                items={[
                  { label: 'View', onSelect: () => navigate(`/sellers/${s.id}`) },
                  { label: 'Archive', danger: true, hidden: !s.allowed?.archive, onSelect: () => setArchiving(s) },
                ]}
              />
            )}
            empty={{ title: sellerTable.hasActiveFilters ? 'No sellers match' : 'No sellers yet', description: sellerTable.hasActiveFilters ? 'Try clearing the search or filters.' : can('sellers.create') ? 'Register the first seller to start tracking properties the company buys.' : undefined }}
          />
        </>
      ) : (
        <>
          <FilterBar search={propertyTable.params.search} onSearch={propertyTable.setSearch} searchPlaceholder="Search property, city or property ID" onReset={propertyTable.reset} canReset={propertyTable.hasActiveFilters}>
            <FilterSelect label="Status" value={propertyTable.params.statusKey} onChange={(v) => propertyTable.setFilter('statusKey', v)} options={(propertyStatuses.data?.PROPERTY_STATUS ?? []).map((m) => ({ value: m.systemKey, label: m.label }))} loading={propertyStatuses.isPending} />
            <FilterSelect label="Inventory" value={propertyTable.params.hasUnit} onChange={(v) => propertyTable.setFilter('hasUnit', v)} options={[{ value: 'true', label: 'Has a unit' }, { value: 'false', label: 'No unit yet' }]} allLabel="Any" />
          </FilterBar>
          <DataTable
            columns={propertyColumns}
            rows={properties.data?.rows}
            meta={properties.data?.meta}
            loading={properties.isFetching}
            error={properties.error}
            onRetry={properties.refetch}
            sort={propertyTable.params.sort}
            onSortChange={propertyTable.setSort}
            onPageChange={propertyTable.setPage}
            getRowId={(p) => p.id}
            onRowClick={(p) => navigate(`/sellers/properties/${p.id}`)}
            empty={{ title: propertyTable.hasActiveFilters ? 'No properties match' : 'No proposed properties yet', description: propertyTable.hasActiveFilters ? 'Try clearing the search or filters.' : 'Properties appear here once a seller registers one.' }}
          />
        </>
      )}

      {creating && <SellerCreateModal onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.personName}?`}
        description="The seller leaves the active list. Their properties, any units bought from them and the full history are kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(archiving.id);
          toast.success('Seller archived');
        }}
      />
    </div>
  );
}
