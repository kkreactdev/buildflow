import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranches, useUsers } from '../../api/admin';
import { useMasterOptions } from '../../api/masters';
import { useReferralMutations, useReferrals } from '../../api/referrals';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { useToast } from '../../hooks/useToast';
import { formatDateFull } from '../../lib/format';
import { ReferralAssignDialog } from './ReferralDialogs';
import { ReferralCreateModal } from './ReferralCreateModal';
import { TypePill } from './TypePill';
import '../enquiries/enquiries.css';

const FILTER_KEYS = ['typeId', 'assignedTo', 'branchId', 'from', 'to', 'isArchived'];

export function ReferralsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, dataScope, branchIds } = usePermissions();
  const table = useTableState({ defaultSort: '-createdAt', filterKeys: FILTER_KEYS });
  const list = useReferrals(table.params);
  const masters = useMasterOptions(['REFERRAL_TYPE']);
  const multiBranch = dataScope === 'ALL' || branchIds.length > 1;
  const branches = useBranches({ limit: 100 });
  const users = useUsers({ isActive: 'true', limit: 100 }, { enabled: can('users.view') && dataScope !== 'OWN' });
  const { archive } = useReferralMutations();
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [archiving, setArchiving] = useState(null);

  const columns = [
    { key: 'referralNo', header: 'Referral ID', sortable: true, render: (r) => <span className="id-chip">{r.referralNo}</span> },
    { key: 'personName', header: 'Name', sortable: true, render: (r) => <strong>{r.name}</strong> },
    { key: 'phone', header: 'Phone', render: (r) => r.phone },
    { key: 'type', header: 'Type', render: (r) => <TypePill type={r.type} /> },
    { key: 'assignedToName', header: 'Assigned to', render: (r) => r.assignedToName ?? 'Unassigned' },
    { key: 'enquiries', header: 'Enquiries', render: (r) => r.enquiryCount },
    { key: 'createdAt', header: 'Created', sortable: true, render: (r) => formatDateFull(r.createdAt) },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Referrals</h2>
        <div className="detail-actions">{can('referrals.create') && <Button onClick={() => setCreating(true)}>New referral</Button>}</div>
      </div>
      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search referral ID, name or phone" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Type" value={table.params.typeId} onChange={(v) => table.setFilter('typeId', v)} options={(masters.data?.REFERRAL_TYPE ?? []).map((m) => ({ value: m._id, label: m.label }))} loading={masters.isPending} />
        {users.data && <FilterSelect label="Assignee" value={table.params.assignedTo} onChange={(v) => table.setFilter('assignedTo', v)} options={[{ value: 'unassigned', label: 'Unassigned' }, ...users.data.rows.map((u) => ({ value: u.id, label: u.name }))]} />}
        {multiBranch && <FilterSelect label="Branch" value={table.params.branchId} onChange={(v) => table.setFilter('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
        <input type="date" className="enq-date" aria-label="Created from" value={table.params.from ?? ''} onChange={(e) => table.setFilter('from', e.target.value)} />
        <input type="date" className="enq-date" aria-label="Created to" value={table.params.to ?? ''} onChange={(e) => table.setFilter('to', e.target.value)} />
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
        getRowId={(r) => r.id}
        onRowClick={(r) => navigate(`/referrals/${r.id}`)}
        rowActions={(r) => (
          <ActionMenu
            items={[
              { label: 'Open', onSelect: () => navigate(`/referrals/${r.id}`) },
              { label: r.assignedTo ? 'Reassign' : 'Assign', hidden: !r.allowed.assign, onSelect: () => setAssigning(r) },
              { label: 'Archive', danger: true, hidden: !r.allowed.archive, onSelect: () => setArchiving(r) },
            ]}
          />
        )}
        empty={{ title: table.hasActiveFilters ? 'No referrals match' : 'No referrals yet', description: table.hasActiveFilters ? 'Try clearing the search or filters.' : can('referrals.create') ? 'Turn a client or employee into a referrer, or add an external person.' : undefined }}
      />
      {creating && <ReferralCreateModal onClose={() => setCreating(false)} />}
      {assigning && <ReferralAssignDialog referral={assigning} onClose={() => setAssigning(null)} />}
      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.referralNo}?`}
        description="The referral disappears from lists, but its history and linked enquiries are kept."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(archiving.id);
          toast.success('Referral archived');
        }}
      />
    </div>
  );
}
