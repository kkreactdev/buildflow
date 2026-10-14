import { useState } from 'react';
import { useWorkflowMutations, useWorkflowStages } from '../../api/masters';
import { DataTable } from '../../components/data/DataTable';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { Select } from '../../components/ui/Select';
import { LockIcon } from '../../components/ui/icons';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import '../masters/masters.css';

const ACTION_LABELS = {
  'sitevisit.schedule': 'Scheduling a site visit',
  'sitevisit.complete': 'Completing a site visit',
  'booking.create': 'Booking a unit',
  'enquiry.convert': 'Converting to a client',
};

function StageForm({ stage, flow, onClose }) {
  const toast = useToast();
  const { create, update } = useWorkflowMutations();
  const editing = Boolean(stage);
  const form = useForm({
    initialValues: { label: stage?.label ?? '', description: stage?.description ?? '', color: stage?.color ?? '#3f6690', afterSystemKey: '', isActive: stage?.isActive ?? true },
    schema: { label: [rules.required('Enter a name'), rules.maxLength(60)], afterSystemKey: editing ? [] : [rules.required('Choose where to insert it')] },
    onSubmit: async (v) => {
      if (editing) {
        await update.mutateAsync({ id: stage._id, label: v.label, description: v.description || null, color: v.color, ...(stage.isSystem ? {} : { isActive: v.isActive }) });
      } else {
        await create.mutateAsync({ label: v.label, ...(v.description ? { description: v.description } : {}), color: v.color, afterSystemKey: v.afterSystemKey });
      }
      toast.success(editing ? 'Stage updated' : 'Stage added');
      onClose();
    },
  });

  return (
    <AdminFormModal open onClose={onClose} title={editing ? 'Edit stage' : 'Add stage'} form={form}>
      {editing && (
        <FormField label="System key (fixed)" hint="Business rules reference this key. It can never be changed, so renaming a stage is always safe.">
          <div className="key-box" data-testid="system-key">
            <LockIcon size={14} />
            {stage.systemKey}
          </div>
        </FormField>
      )}
      <FormField label="Display name" htmlFor="s-label" required error={form.errors.label}>
        <Input id="s-label" autoFocus value={form.values.label} onChange={form.handleChange('label')} />
      </FormField>
      <FormField label="Description" htmlFor="s-desc">
        <Input id="s-desc" value={form.values.description} onChange={form.handleChange('description')} />
      </FormField>
      <FormField label="Colour" htmlFor="s-color">
        <input id="s-color" type="color" value={form.values.color} onChange={form.handleChange('color')} />
      </FormField>
      {!editing && (
        <FormField label="Insert after" htmlFor="s-after" required error={form.errors.afterSystemKey} hint="The new stage becomes a required step between this stage and the next.">
          <Select id="s-after" value={form.values.afterSystemKey} onChange={form.handleChange('afterSystemKey')}>
            <option value="">Select a stage…</option>
            {flow.slice(0, -1).map((s) => (
              <option key={s._id} value={s.systemKey}>
                {s.label}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      {editing && !stage.isSystem && (
        <label className="check-item">
          <input type="checkbox" checked={form.values.isActive} onChange={form.handleChange('isActive')} />
          Active
        </label>
      )}
      {editing && stage.isSystem && <p className="muted">Core pipeline stages cannot be deactivated.</p>}
    </AdminFormModal>
  );
}

/**
 * Pipeline configuration. The server is authoritative (it validates every
 * reorder); `canMove` here only avoids offering moves that are always refused:
 * core stages keep their order, NEW stays first and CONVERTED last.
 */
function canMove(flow, i, delta) {
  const a = flow[i];
  const b = flow[i + delta];
  if (!a || !b) return false;
  if (a.isSystem && b.isSystem) return false; // swapping two core stages
  const target = i + delta;
  if (target === 0 || target === flow.length - 1) return false; // NEW first, CONVERTED last
  return true;
}

export function WorkflowPage() {
  const { can, dataScope } = usePermissions();
  const toast = useToast();
  const query = useWorkflowStages();
  const { update, reorder } = useWorkflowMutations();
  const [editing, setEditing] = useState(null);
  const canManage = can('masters.manage') && dataScope === 'ALL';

  const stages = query.data ?? [];
  const flow = stages.filter((s) => s.kind === 'FLOW');

  async function move(stage, delta) {
    const i = flow.findIndex((s) => s._id === stage._id);
    const ids = flow.map((s) => s._id);
    [ids[i], ids[i + delta]] = [ids[i + delta], ids[i]];
    try {
      await reorder.mutateAsync(ids);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const columns = [
    { key: 'order', header: '#', width: 56, render: (s) => (s.kind === 'FLOW' ? s.order : '—') },
    { key: 'label', header: 'Display name', render: (s) => <strong>{s.label}</strong> },
    { key: 'systemKey', header: 'System key', render: (s) => <span className="code-text"><LockIcon size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{s.systemKey}</span> },
    {
      key: 'entryPolicy',
      header: 'Entered by',
      render: (s) =>
        s.kind === 'LOST' ? <Pill label="Mark lost (reason required)" size="sm" /> : s.entryPolicy === 'DOMAIN' ? <Pill label={ACTION_LABELS[s.domainOperation] ?? 'Dedicated action'} size="sm" /> : 'Moving the enquiry',
    },
    { key: 'color', header: 'Colour', render: (s) => (s.color ? <span className="swatch" style={{ background: s.color }} title={s.color} /> : '—') },
    { key: 'isActive', header: 'Status', render: (s) => <Pill label={s.isActive ? 'Active' : 'Inactive'} size="sm" color={s.isActive ? 'var(--success)' : 'var(--danger)'} bg={s.isActive ? 'var(--success-soft)' : 'var(--danger-soft)'} /> },
  ];

  return (
    <div>
      <div className="masters-panel-head">
        <div>
          <h2>Enquiry workflow</h2>
          <p className="muted">
            Stages an enquiry moves through, in order. Stages cannot be skipped. Core stages keep their fixed system key and order; you can rename them, recolour them and add your own stages between them.
          </p>
        </div>
        {canManage && <Button onClick={() => setEditing('new')}>Add stage</Button>}
      </div>
      <DataTable
        columns={columns}
        rows={stages}
        loading={query.isFetching}
        error={query.error}
        onRetry={query.refetch}
        getRowId={(s) => s._id}
        rowActions={(s) => {
          const i = flow.findIndex((x) => x._id === s._id);
          const movable = s.kind === 'FLOW';
          return (
            <ActionMenu
              items={[
                { label: 'Edit', hidden: !canManage, onSelect: () => setEditing(s) },
                { label: 'Move up', hidden: !canManage || !movable, disabled: !canMove(flow, i, -1), onSelect: () => move(s, -1) },
                { label: 'Move down', hidden: !canManage || !movable, disabled: !canMove(flow, i, 1), onSelect: () => move(s, 1) },
                { label: s.isActive ? 'Deactivate' : 'Activate', hidden: !canManage || s.isSystem, onSelect: () => update.mutate({ id: s._id, isActive: !s.isActive }, { onError: (e) => toast.error(e.message) }) },
              ]}
            />
          );
        }}
        empty={{ title: 'No stages configured', description: 'Run the seed to create the default pipeline.' }}
      />
      {editing && <StageForm stage={editing === 'new' ? null : editing} flow={flow} onClose={() => setEditing(null)} />}
    </div>
  );
}
