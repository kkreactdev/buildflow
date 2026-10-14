import { useState } from 'react';
import { useMasterOptions } from '../../api/masters';
import { useTemplateMutations, useTemplates } from '../../api/whatsappTemplates';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Pill } from '../../components/ui/Pill';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { useToast } from '../../hooks/useToast';
import { TemplateFormModal } from './TemplateFormModal';
import '../enquiries/enquiries.css';

const label = (m) => (m ? (m.isActive === false ? `${m.label} (inactive)` : m.label) : '—');
const FILTER_KEYS = ['categoryId', 'eventId', 'isActive', 'isArchived'];

/** WhatsApp message templates. Company-wide; this release stores them only (nothing is sent). */
export function WhatsAppTemplatesPage() {
  const toast = useToast();
  const { can, dataScope } = usePermissions();
  const table = useTableState({ defaultSort: 'name', filterKeys: FILTER_KEYS });
  const query = useTemplates(table.params);
  const masters = useMasterOptions(['WA_CATEGORY', 'WA_EVENT']);
  const { update, archive } = useTemplateMutations();
  const [editing, setEditing] = useState(null); // null | 'new' | template
  const [archiving, setArchiving] = useState(null);
  const canManage = can('whatsapp_masters.manage') && dataScope === 'ALL';
  const opt = (type) => (masters.data?.[type] ?? []).map((m) => ({ value: m._id, label: m.label }));

  const columns = [
    { key: 'name', header: 'Name', sortable: true, render: (t) => <strong>{t.name}</strong> },
    { key: 'category', header: 'Category', render: (t) => label(t.category) },
    { key: 'event', header: 'Event', render: (t) => label(t.event) },
    { key: 'body', header: 'Message', render: (t) => <span className="tpl-preview">{t.body.length > 80 ? `${t.body.slice(0, 80)}…` : t.body}</span> },
    { key: 'variables', header: 'Placeholders', render: (t) => (t.variables.length ? t.variables.join(', ') : '—') },
    { key: 'state', header: 'State', render: (t) => (t.isArchived ? <Pill label="Archived" size="sm" /> : t.isActive ? <Pill label="Enabled" size="sm" dot color="#047857" bg="#04785722" /> : <Pill label="Disabled" size="sm" />) },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>WhatsApp templates</h2>
        <div className="detail-actions">{canManage && <Button onClick={() => setEditing('new')}>New template</Button>}</div>
      </div>
      <p className="muted">Templates are company-wide. Messages are not sent from BuildFlow yet; this is where they are prepared.</p>
      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search name or message" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Category" value={table.params.categoryId} onChange={(v) => table.setFilter('categoryId', v)} options={opt('WA_CATEGORY')} loading={masters.isPending} />
        <FilterSelect label="Event" value={table.params.eventId} onChange={(v) => table.setFilter('eventId', v)} options={opt('WA_EVENT')} loading={masters.isPending} />
        <FilterSelect label="State" value={table.params.isActive} onChange={(v) => table.setFilter('isActive', v)} options={[{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }]} allLabel="Any" />
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
        getRowId={(t) => t.id}
        rowActions={(t) => (
          <ActionMenu
            items={[
              { label: 'Edit', hidden: !t.allowed.edit, onSelect: () => setEditing(t) },
              { label: t.isActive ? 'Disable' : 'Enable', hidden: !t.allowed.edit, onSelect: async () => { await update.mutateAsync({ id: t.id, isActive: !t.isActive }); toast.success(t.isActive ? 'Template disabled' : 'Template enabled'); } },
              { label: 'Archive', danger: true, hidden: !t.allowed.archive, onSelect: () => setArchiving(t) },
            ]}
          />
        )}
        empty={{ title: table.hasActiveFilters ? 'No templates match' : 'No templates yet', description: table.hasActiveFilters ? 'Try clearing the search or filters.' : canManage ? 'Create the first template.' : undefined }}
      />
      {editing && <TemplateFormModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.name}?`}
        description="The template disappears from lists but is kept. Its name becomes free to reuse."
        confirmLabel="Archive"
        danger
        onConfirm={async () => {
          await archive.mutateAsync(archiving.id);
          toast.success('Template archived');
        }}
      />
    </div>
  );
}
