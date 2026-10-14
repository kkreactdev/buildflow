import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useConflicts } from '../../api/bookings';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { useTableState } from '../../hooks/useTableState';
import { formatDateTime } from '../../lib/format';
import { ResolveConflictDialog } from './BookingDialogs';

/** The manager queue of booking attempts that lost a unit to someone else. Open ones first by default. */
export function ConflictsPage() {
  const table = useTableState({ defaultSort: '-createdAt', filterKeys: ['status'] });
  const status = table.params.status ?? 'OPEN';
  const query = useConflicts({ ...table.params, status: status === 'ALL' ? undefined : status });
  const [resolving, setResolving] = useState(null);

  const columns = [
    { key: 'createdAt', header: 'When', sortable: true, render: (c) => formatDateTime(c.createdAt) },
    { key: 'unit', header: 'Unit', render: (c) => <Link to={`/units/${c.unitId}`}>{c.unitCode}</Link> },
    { key: 'attempt', header: 'Attempted for', render: (c) => <><strong>{c.attemptedPersonName}</strong> · <Link to={`/enquiries/${c.attemptedEnquiryId}`}>{c.attemptedEnquiryNo}</Link></> },
    { key: 'by', header: 'Tried by', render: (c) => c.attemptedByName ?? '—' },
    { key: 'holder', header: 'Held by', render: (c) => (c.existingBookingId ? <Link to={`/bookings/${c.existingBookingId}`}>{c.existingBookingNo}</Link> : c.existingBookingNo ?? '—') },
    { key: 'status', header: 'Status', render: (c) => (c.status === 'OPEN' ? <Pill label="Open" size="sm" dot color="#a3342b" bg="#a3342b22" /> : <Pill label={c.resolution === 'REPLACE' ? 'Replaced' : 'Kept existing'} size="sm" />) },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Booking conflicts</h2>
        <div className="detail-actions"><Link to="/bookings" className="btn btn-secondary">Bookings</Link></div>
      </div>
      <FilterBar onReset={table.reset} canReset={Boolean(table.params.status)}>
        <FilterSelect label="Status" value={table.params.status} allLabel="Open" onChange={(v) => table.setFilter('status', v)} options={[{ value: 'RESOLVED', label: 'Resolved' }, { value: 'ALL', label: 'All' }]} />
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
        rowActions={(c) => (c.allowed.resolve ? <Button variant="secondary" onClick={() => setResolving(c)}>Resolve…</Button> : null)}
        empty={{ title: status === 'OPEN' ? 'No open conflicts' : 'No conflicts', description: 'When two people try to book the same unit, the one who loses appears here.' }}
      />
      {resolving && <ResolveConflictDialog conflict={resolving} onClose={() => setResolving(null)} />}
    </div>
  );
}
