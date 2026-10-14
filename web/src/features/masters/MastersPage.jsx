import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBranches } from '../../api/admin';
import { useMasterList, useMasterMutations, useMasterTypes } from '../../api/masters';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { QueryState } from '../../components/data/QueryState';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Pill } from '../../components/ui/Pill';
import { LockIcon } from '../../components/ui/icons';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { useToast } from '../../hooks/useToast';
import { MasterFormModal } from './MasterFormModal';
import './masters.css';

const FILTER_KEYS = ['isActive', 'branchId'];

function TypePanel({ def }) {
  const { can, dataScope } = usePermissions();
  const toast = useToast();
  const branches = useBranches();
  const table = useTableState({ defaultSort: 'sortOrder', defaultLimit: 100, filterKeys: FILTER_KEYS });
  const query = useMasterList(def.key, table.params);
  const { update, reorder, remove } = useMasterMutations(def.key);
  const [editing, setEditing] = useState(null); // null | 'new' | value
  const [toggling, setToggling] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // The server enforces both; the UI just hides what would be refused.
  const canManage = can(def.managePermission) && (def.scope === 'BRANCH' || dataScope === 'ALL');
  const rows = query.data?.rows ?? [];
  const branchFilter = table.params.branchId;
  const showAll = query.data && query.data.meta.total === rows.length;
  // Reordering the visible list is only meaningful when it IS the whole list (one branch at a time for branch types).
  const canReorder = canManage && def.reorderable && showAll && !table.params.search && !table.params.isActive && (def.scope === 'GLOBAL' || Boolean(branchFilter));

  async function move(index, delta) {
    const ids = rows.map((r) => r._id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    try {
      await reorder.mutateAsync({ ids, ...(def.scope === 'BRANCH' ? { branchId: branchFilter } : {}) });
    } catch (err) {
      toast.error(err.message);
    }
  }

  const branchName = useMemo(() => new Map((branches.data?.rows ?? []).map((b) => [b._id, b.name])), [branches.data]);

  const columns = [
    { key: 'sortOrder', header: '#', width: 56, render: (m) => m.sortOrder },
    {
      key: 'label',
      header: 'Name',
      render: (m) => (
        <div>
          <strong>{m.label}</strong> <span className="code-text">{m.systemKey ?? m.code}</span>
          {m.systemKey && <LockIcon size={12} style={{ marginLeft: 6, verticalAlign: 'middle' }} aria-label="System value" />}
        </div>
      ),
    },
    ...(def.scope === 'BRANCH' ? [{ key: 'branchId', header: 'Branch', render: (m) => branchName.get(m.branchId) ?? '—' }] : []),
    ...(def.hasColor ? [{ key: 'color', header: 'Colour', render: (m) => (m.color ? <span className="swatch" style={{ background: m.color }} title={m.color} /> : '—') }] : []),
    { key: 'isActive', header: 'Status', render: (m) => <Pill label={m.isActive ? 'Active' : 'Inactive'} size="sm" color={m.isActive ? 'var(--success)' : 'var(--danger)'} bg={m.isActive ? 'var(--success-soft)' : 'var(--danger-soft)'} /> },
  ];

  return (
    <div>
      <div className="masters-panel-head">
        <div>
          <h2>{def.label}</h2>
          <p className="muted">{def.description}</p>
        </div>
        {canManage && <Button onClick={() => setEditing('new')}>New value</Button>}
      </div>

      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search name or code" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Status" value={table.params.isActive} onChange={(v) => table.setFilter('isActive', v)} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} allLabel="Any" />
        {def.scope === 'BRANCH' && <FilterSelect label="Branch" value={branchFilter} onChange={(v) => table.setFilter('branchId', v)} options={(branches.data?.rows ?? []).map((b) => ({ value: b._id, label: b.name }))} loading={branches.isPending} />}
      </FilterBar>
      {canManage && def.reorderable && !canReorder && <p className="muted" style={{ marginBottom: 12 }}>Clear filters{def.scope === 'BRANCH' ? ' and choose a branch' : ''} to reorder values.</p>}

      <DataTable
        columns={columns}
        rows={rows}
        meta={query.data?.meta}
        loading={query.isFetching}
        error={query.error}
        onRetry={query.refetch}
        getRowId={(m) => m._id}
        onPageChange={table.setPage}
        rowActions={(m) => {
          const i = rows.findIndex((r) => r._id === m._id);
          return (
            <ActionMenu
              items={[
                { label: 'Edit', hidden: !canManage, onSelect: () => setEditing(m) },
                { label: m.isActive ? 'Deactivate' : 'Activate', hidden: !canManage || !def.disableable || Boolean(m.systemKey), onSelect: () => (m.isActive ? setToggling(m) : update.mutate({ id: m._id, isActive: true }, { onError: (e) => toast.error(e.message) })) },
                { label: 'Move up', hidden: !canReorder, disabled: i <= 0, onSelect: () => move(i, -1) },
                { label: 'Move down', hidden: !canReorder, disabled: i < 0 || i >= rows.length - 1, onSelect: () => move(i, 1) },
                { label: 'Delete', danger: true, hidden: !canManage || !def.deletable || Boolean(m.systemKey), onSelect: () => setDeleting(m) },
              ]}
            />
          );
        }}
        empty={{ title: `No ${def.label.toLowerCase()} yet`, description: canManage ? 'Use “New value” to add the first one.' : 'An administrator has not configured any yet.' }}
      />

      {editing && <MasterFormModal def={def} value={editing === 'new' ? null : editing} defaultBranchId={branchFilter} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(toggling)}
        onClose={() => setToggling(null)}
        title={`Deactivate “${toggling?.label}”?`}
        description="It will no longer be selectable for new records. Existing records keep showing it, and you can activate it again at any time."
        confirmLabel="Deactivate"
        danger
        onConfirm={async () => {
          await update.mutateAsync({ id: toggling._id, isActive: false });
          toast.success('Deactivated');
        }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.label}”?`}
        description="Only values that no record uses can be deleted. If it is in use, deactivate it instead."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await remove.mutateAsync(deleting._id);
          toast.success('Deleted');
        }}
      />
    </div>
  );
}

export function MastersPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const types = useMasterTypes();
  const { can } = usePermissions();
  const selectedKey = decodeURIComponent(pathname.split('/')[2] ?? '');

  return (
    <QueryState query={types} isEmpty={(d) => d.length === 0} empty={{ title: 'No master types' }}>
      {(list) => {
        const groups = [...new Set(list.map((t) => t.group))];
        const def = list.find((t) => t.key === selectedKey) ?? list[0];
        return (
          <div>
            <div className="page-header">
              <h2>Masters</h2>
            </div>
            <div className="masters-layout">
              <nav className="masters-nav" aria-label="Master categories">
                {groups.map((g) => (
                  <div key={g}>
                    <div className="masters-nav-group-title">{g}</div>
                    {list.filter((t) => t.group === g).map((t) => (
                      <button key={t.key} type="button" className={`masters-nav-item ${t.key === def.key ? 'is-active' : ''}`} onClick={() => navigate(`/masters/${t.key}`)}>
                        {t.label}
                      </button>
                    ))}
                    {g === 'Enquiries' && can('masters.view') && (
                      <button type="button" className="masters-nav-item" onClick={() => navigate('/workflow')}>
                        Enquiry Statuses →
                      </button>
                    )}
                  </div>
                ))}
              </nav>
              <TypePanel key={def.key} def={def} />
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}
