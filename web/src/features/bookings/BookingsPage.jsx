import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useBranches, useUsers } from '../../api/admin';
import { useBookings } from '../../api/bookings';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { formatWhen } from '../followups/datetime';
import { BookingStatusPill } from './BookingStatusPill';
import { ReleaseDialog } from './BookingDialogs';
import '../enquiries/enquiries.css';

const FILTER_KEYS = ['status', 'salespersonId', 'branchId', 'unitId', 'enquiryId', 'from', 'to'];

/** Bookings, newest first. Search, filters, sorting and paging are all server-side; active and released are record states. */
export function BookingsPage() {
  const navigate = useNavigate();
  const { can, dataScope, branchIds } = usePermissions();
  const table = useTableState({ defaultSort: '-bookingDate', filterKeys: FILTER_KEYS });
  const query = useBookings(table.params);
  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branches = useBranches({ limit: 100 });
  const users = useUsers({ isActive: 'true', limit: 100 }, { enabled: can('users.view') && dataScope !== 'OWN' });
  const [releasing, setReleasing] = useState(null);

  const columns = [
    { key: 'bookingNo', header: 'Booking ID', sortable: true, render: (b) => <span className="id-chip">{b.bookingNo}</span> },
    { key: 'unitCode', header: 'Unit', sortable: true, render: (b) => <Link to={`/units/${b.unitId}`} onClick={(e) => e.stopPropagation()}>{b.unitCode}</Link> },
    { key: 'personName', header: 'Person', sortable: true, render: (b) => <strong>{b.name}</strong> },
    { key: 'enquiry', header: 'Enquiry', render: (b) => <Link to={`/enquiries/${b.enquiryId}`} onClick={(e) => e.stopPropagation()}>{b.enquiryNo}</Link> },
    { key: 'salesperson', header: 'Salesperson', render: (b) => b.salespersonName ?? '—' },
    { key: 'bookingDate', header: 'Booked on', sortable: true, render: (b) => formatWhen(b.bookingDate) },
    { key: 'status', header: 'Status', render: (b) => <BookingStatusPill booking={b} /> },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Bookings</h2>
        <div className="detail-actions">
          <Link to="/bookings/conflicts" className="btn btn-secondary">Conflicts</Link>
        </div>
      </div>
      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search booking ID, unit, enquiry, person or phone" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Status" value={table.params.status} onChange={(v) => table.setFilter('status', v)} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'RELEASED', label: 'Released' }]} />
        {users.data && <FilterSelect label="Salesperson" value={table.params.salespersonId} onChange={(v) => table.setFilter('salespersonId', v)} options={users.data.rows.map((u) => ({ value: u.id, label: u.name }))} />}
        {multiBranch && <FilterSelect label="Branch" value={table.params.branchId} onChange={(v) => table.setFilter('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
        <input type="date" className="enq-date" aria-label="From date" value={table.params.from ?? ''} onChange={(e) => table.setFilter('from', e.target.value)} />
        <input type="date" className="enq-date" aria-label="To date" value={table.params.to ?? ''} onChange={(e) => table.setFilter('to', e.target.value)} />
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
        getRowId={(b) => b.id}
        onRowClick={(b) => navigate(`/bookings/${b.id}`)}
        rowActions={(b) => <ActionMenu items={[{ label: 'Open', onSelect: () => navigate(`/bookings/${b.id}`) }, { label: 'Release…', danger: true, hidden: !b.allowed.release, onSelect: () => setReleasing(b) }]} />}
        empty={{ title: table.hasActiveFilters ? 'No bookings match' : 'No bookings yet', description: table.hasActiveFilters ? 'Try clearing the search or filters.' : 'Book a unit from a unit or an enquiry.' }}
      />
      {releasing && <ReleaseDialog booking={releasing} onClose={() => setReleasing(null)} />}
    </div>
  );
}
