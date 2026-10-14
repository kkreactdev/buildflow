import { useState } from 'react';
import { DataTable } from '../components/data/DataTable';
import { FilterBar, FilterSelect } from '../components/data/FilterBar';
import { ActionMenu } from '../components/ui/ActionMenu';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Drawer } from '../components/ui/Drawer';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { Pill } from '../components/ui/Pill';
import { Segmented } from '../components/ui/Segmented';
import { useToast } from '../hooks/useToast';
import { useTableState } from '../hooks/useTableState';
import './pages.css';

// DEV-ONLY gallery for eyeballing the shared building blocks. Data here is
// fake and local; real pages fetch rows and options from the API (masters).
const FILTER_KEYS = ['group'];
const ROWS = Array.from({ length: 53 }, (_, i) => ({ id: i + 1, name: `Sample record ${i + 1}`, group: i % 2 ? 'B' : 'A', color: i % 2 ? '#3f6690' : '#047857' }));

export function ComponentsPreviewPage() {
  const toast = useToast();
  const table = useTableState({ defaultSort: 'name', filterKeys: FILTER_KEYS });
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [seg, setSeg] = useState('a');

  const { page, limit, search, group } = table.params;
  const filtered = ROWS.filter((r) => (!group || r.group === group) && (!search || r.name.toLowerCase().includes(search.toLowerCase())));
  const rows = filtered.slice((page - 1) * limit, page * limit);

  return (
    <div className="page-section">
      <div className="preview-row">
        <Button onClick={() => toast.success('Saved')}>Success toast</Button>
        <Button variant="secondary" onClick={() => toast.error('Something failed')}>Error toast</Button>
        <Button variant="secondary" onClick={() => setModal(true)}>Modal</Button>
        <Button variant="secondary" onClick={() => setDrawer(true)}>Drawer</Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>Confirm</Button>
        <Segmented value={seg} onChange={setSeg} options={[{ value: 'a', label: 'List' }, { value: 'b', label: 'Kanban' }]} />
        <Pill label="Pill" color="#047857" bg="rgba(4,120,87,.14)" dot />
      </div>

      <FilterBar search={search} onSearch={table.setSearch} onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Group" value={group} onChange={(v) => table.setFilter('group', v)} options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }]} />
      </FilterBar>

      <DataTable
        columns={[
          { key: 'id', header: 'ID', width: 80 },
          { key: 'name', header: 'Name', sortable: true },
          { key: 'group', header: 'Group', render: (r) => <Pill label={r.group} color={r.color} bg={`${r.color}22`} size="sm" /> },
        ]}
        rows={rows}
        sort={table.params.sort}
        onSortChange={table.setSort}
        meta={{ page, limit, total: filtered.length }}
        onPageChange={table.setPage}
        rowActions={(r) => <ActionMenu items={[{ label: 'View', onSelect: () => toast.info(`View ${r.id}`) }, { label: 'Delete', danger: true, onSelect: () => toast.error('Not allowed in preview') }]} />}
        empty={{ title: 'No matches', description: 'Try clearing the filters.' }}
      />
      <EmptyState title="Empty state" description="Used when a list has no rows." />

      <Modal open={modal} onClose={() => setModal(false)} title="Modal" footer={<Button onClick={() => setModal(false)}>Close</Button>}>
        Modal body
      </Modal>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer">
        Drawer body
      </Drawer>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => new Promise((r) => setTimeout(r, 600))} title="Delete record?" description="Async-aware confirm." danger confirmLabel="Delete" />
    </div>
  );
}
