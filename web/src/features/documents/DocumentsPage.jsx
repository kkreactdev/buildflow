import { Link, useNavigate } from 'react-router-dom';
import { useBranches } from '../../api/admin';
import { useDocumentEntityTypes, useDocuments } from '../../api/documents';
import { useMasterOptions } from '../../api/masters';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Pill } from '../../components/ui/Pill';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { formatDateFull } from '../../lib/format';
import { entityPath, sizeLabel } from './entityLinks';
import { useDocumentActions } from './useDocumentActions';
import '../enquiries/enquiries.css';

const FILTER_KEYS = ['documentTypeId', 'entityType', 'branchId', 'from', 'to', 'isArchived'];

/**
 * All documents the user may reach. Documents are added from the record they belong to (client, enquiry, unit, ...), never from here,
 * so there is no way to hold a document that is not attached to a business record.
 */
export function DocumentsPage() {
  const navigate = useNavigate();
  const { dataScope, branchIds } = usePermissions();
  const table = useTableState({ defaultSort: '-createdAt', filterKeys: FILTER_KEYS });
  const query = useDocuments(table.params);
  const masters = useMasterOptions(['DOCUMENT_TYPE']);
  const types = useDocumentEntityTypes();
  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branches = useBranches({ limit: 100 });
  const actions = useDocumentActions();

  const columns = [
    { key: 'documentNo', header: 'Document ID', sortable: true, render: (d) => <span className="id-chip">{d.documentNo}</span> },
    { key: 'name', header: 'Title', sortable: true, render: (d) => <strong>{d.name}</strong> },
    { key: 'type', header: 'Type', render: (d) => (d.type ? (d.type.isActive === false ? `${d.type.label} (inactive)` : d.type.label) : '—') },
    { key: 'entity', header: 'Attached to', render: (d) => <Link to={entityPath(d.entityType, d.entityId) ?? '#'} onClick={(e) => e.stopPropagation()}>{d.entityTypeLabel} {d.entityNo}</Link> },
    { key: 'file', header: 'File', render: (d) => `${d.file.originalName} · ${sizeLabel(d.file.bytes)}` },
    { key: 'createdAt', header: 'Added', sortable: true, render: (d) => formatDateFull(d.createdAt) },
    { key: 'state', header: '', render: (d) => (d.isArchived ? <Pill label="Archived" size="sm" /> : null) },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Documents</h2>
      </div>
      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search document ID, title, file name or record number" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Type" value={table.params.documentTypeId} onChange={(v) => table.setFilter('documentTypeId', v)} options={(masters.data?.DOCUMENT_TYPE ?? []).map((m) => ({ value: m._id, label: m.label }))} loading={masters.isPending} />
        <FilterSelect label="Record" value={table.params.entityType} onChange={(v) => table.setFilter('entityType', v)} options={(types.data ?? []).map((t) => ({ value: t.type, label: t.label }))} loading={types.isPending} />
        {multiBranch && <FilterSelect label="Branch" value={table.params.branchId} onChange={(v) => table.setFilter('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
        <input type="date" className="enq-date" aria-label="Added from" value={table.params.from ?? ''} onChange={(e) => table.setFilter('from', e.target.value)} />
        <input type="date" className="enq-date" aria-label="Added to" value={table.params.to ?? ''} onChange={(e) => table.setFilter('to', e.target.value)} />
        <FilterSelect label="Archive" value={table.params.isArchived} onChange={(v) => table.setFilter('isArchived', v)} options={[{ value: 'true', label: 'Archived' }]} allLabel="Active" />
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
        getRowId={(d) => d.id}
        onRowClick={(d) => navigate(`/documents/${d.id}`)}
        rowActions={(d) => <ActionMenu items={[{ label: 'Details', onSelect: () => navigate(`/documents/${d.id}`) }, ...actions.menuItems(d)]} />}
        empty={{ title: table.hasActiveFilters ? 'No documents match' : 'No documents yet', description: table.hasActiveFilters ? 'Try clearing the search or filters.' : 'Add documents from a client, enquiry, unit, site visit, booking or referral.' }}
      />
      {actions.element}
    </div>
  );
}
