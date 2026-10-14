import { useState } from 'react';
import { useBranchMutations, useBranches } from '../../api/admin';
import { DataTable } from '../../components/data/DataTable';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from './AdminFormModal';
import './admin.css';

function BranchForm({ branch, onClose }) {
  const toast = useToast();
  const { create, update } = useBranchMutations();
  const editing = Boolean(branch);
  const form = useForm({
    initialValues: { name: branch?.name ?? '', code: branch?.code ?? '', address: branch?.address ?? '', phone: branch?.phone ?? '', isActive: branch?.isActive ?? true },
    schema: { name: [rules.required(), rules.minLength(2)], code: [rules.required(), rules.minLength(2)] },
    onSubmit: async (v) => {
      if (editing) await update.mutateAsync({ id: branch._id, name: v.name, code: v.code, address: v.address || null, phone: v.phone || null, isActive: v.isActive });
      else await create.mutateAsync({ name: v.name, code: v.code, ...(v.address ? { address: v.address } : {}), ...(v.phone ? { phone: v.phone } : {}) });
      toast.success(editing ? 'Branch updated' : 'Branch created');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={editing ? 'Edit branch' : 'New branch'} form={form}>
      <FormField label="Name" htmlFor="b-name" required error={form.errors.name}>
        <Input id="b-name" value={form.values.name} onChange={form.handleChange('name')} />
      </FormField>
      <FormField label="Code" htmlFor="b-code" required hint="Short unique code, e.g. CHN" error={form.errors.code}>
        <Input id="b-code" value={form.values.code} onChange={form.handleChange('code')} />
      </FormField>
      <FormField label="Address" htmlFor="b-addr">
        <Input id="b-addr" value={form.values.address} onChange={form.handleChange('address')} />
      </FormField>
      <FormField label="Phone" htmlFor="b-phone">
        <Input id="b-phone" value={form.values.phone} onChange={form.handleChange('phone')} />
      </FormField>
      {editing && (
        <label className="check-item">
          <input type="checkbox" checked={form.values.isActive} onChange={form.handleChange('isActive')} />
          Active
        </label>
      )}
    </AdminFormModal>
  );
}

export function BranchesPage() {
  const { can } = usePermissions();
  const query = useBranches();
  const [editing, setEditing] = useState(null);
  const canManage = can('branches.manage');

  const columns = [
    { key: 'name', header: 'Branch', render: (b) => <strong>{b.name}</strong> },
    { key: 'code', header: 'Code' },
    { key: 'address', header: 'Address', wrap: true, render: (b) => b.address || '—' },
    { key: 'isActive', header: 'Status', render: (b) => <Pill label={b.isActive ? 'Active' : 'Inactive'} size="sm" color={b.isActive ? 'var(--success)' : 'var(--danger)'} bg={b.isActive ? 'var(--success-soft)' : 'var(--danger-soft)'} /> },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Branches</h2>
        {canManage && <Button onClick={() => setEditing('new')}>New branch</Button>}
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.rows}
        loading={query.isFetching}
        error={query.error}
        onRetry={query.refetch}
        getRowId={(b) => b._id}
        rowActions={(b) => <ActionMenu items={[{ label: 'Edit', hidden: !canManage, onSelect: () => setEditing(b) }]} />}
        empty={{ title: 'No branches yet', description: canManage ? 'Create the first branch to start assigning users.' : undefined }}
      />
      {editing && <BranchForm branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
