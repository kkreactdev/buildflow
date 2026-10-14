import { useState } from 'react';
import { useRoleMutations, useRoles, usePermissionsCatalog } from '../../api/admin';
import { DataTable } from '../../components/data/DataTable';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { Select } from '../../components/ui/Select';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from './AdminFormModal';
import { DATA_SCOPE_OPTIONS, dataScopeLabel, permissionActionLabel, permissionGroupLabel } from './labels';
import './admin.css';

function RoleForm({ role, onClose, canManage }) {
  const toast = useToast();
  const catalog = usePermissionsCatalog();
  const { create, update } = useRoleMutations();
  const editing = Boolean(role);
  const wildcard = role?.permissions.includes('*');
  const readOnly = !canManage || wildcard;

  const form = useForm({
    initialValues: { name: role?.name ?? '', description: role?.description ?? '', dataScope: role?.dataScope ?? 'OWN', permissions: role?.permissions ?? [] },
    schema: { name: [rules.required(), rules.minLength(2)] },
    onSubmit: async (v) => {
      const body = { name: v.name, description: v.description || undefined, dataScope: v.dataScope, permissions: v.permissions };
      if (editing) await update.mutateAsync({ id: role._id, ...body, description: v.description || null });
      else await create.mutateAsync(body);
      toast.success(editing ? 'Role updated' : 'Role created');
      onClose();
    },
  });

  const toggle = (key) =>
    form.setValue('permissions', form.values.permissions.includes(key) ? form.values.permissions.filter((p) => p !== key) : [...form.values.permissions, key]);

  return (
    <AdminFormModal open onClose={onClose} title={editing ? (readOnly ? `Role: ${role.name}` : 'Edit role') : 'New role'} form={form} size="lg">
      {wildcard && <p className="muted">The Super Admin role has every permission and cannot be changed.</p>}
      <FormField label="Name" htmlFor="r-name" required error={form.errors.name}>
        <Input id="r-name" disabled={readOnly || role?.isSystem} value={form.values.name} onChange={form.handleChange('name')} />
      </FormField>
      <FormField label="Description" htmlFor="r-desc">
        <Input id="r-desc" disabled={readOnly} value={form.values.description} onChange={form.handleChange('description')} />
      </FormField>
      <FormField label="Data scope" htmlFor="r-scope" hint="What records this role can see: everything, its own branches, or only its own records.">
        <Select id="r-scope" disabled={readOnly} value={form.values.dataScope} onChange={form.handleChange('dataScope')}>
          {DATA_SCOPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </FormField>
      {!wildcard && (
        <FormField label="Permissions" error={form.errors.permissions}>
          <div className="perm-matrix">
            {catalog.isPending && <span className="muted">Loading permissions…</span>}
            {catalog.data &&
              Object.entries(catalog.data).map(([group, actions]) => (
                <div key={group}>
                  <div className="perm-group-title">{permissionGroupLabel(group)}</div>
                  <div className="check-list">
                    {actions.map((action) => {
                      const key = `${group}.${action}`;
                      return (
                        <label key={key} className="check-item">
                          <input type="checkbox" disabled={readOnly} checked={form.values.permissions.includes(key)} onChange={() => toggle(key)} />
                          {permissionActionLabel(action)}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </FormField>
      )}
    </AdminFormModal>
  );
}

export function RolesPage() {
  const { can } = usePermissions();
  const toast = useToast();
  const query = useRoles();
  const { remove } = useRoleMutations();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const canManage = can('roles.manage');

  const columns = [
    { key: 'name', header: 'Role', render: (r) => <strong>{r.name}</strong> },
    { key: 'dataScope', header: 'Data scope', render: (r) => dataScopeLabel(r.dataScope) },
    { key: 'permissions', header: 'Permissions', render: (r) => (r.permissions.includes('*') ? 'All' : r.permissions.length) },
    { key: 'isSystem', header: 'Type', render: (r) => (r.isSystem ? <Pill label="System" size="sm" /> : 'Custom') },
    { key: 'isActive', header: 'Status', render: (r) => (r.isActive ? 'Active' : 'Inactive') },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Roles &amp; Permissions</h2>
        {canManage && <Button onClick={() => setEditing('new')}>New role</Button>}
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.rows}
        loading={query.isFetching}
        error={query.error}
        onRetry={query.refetch}
        getRowId={(r) => r._id}
        onRowClick={setEditing}
        rowActions={(r) => (
          <ActionMenu
            items={[
              { label: canManage ? 'Edit' : 'View', onSelect: () => setEditing(r) },
              { label: 'Delete', danger: true, hidden: !canManage || r.isSystem, onSelect: () => setDeleting(r) },
            ]}
          />
        )}
        empty={{ title: 'No roles' }}
      />
      {editing && <RoleForm role={editing === 'new' ? null : editing} canManage={canManage} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete role?"
        description={`"${deleting?.name}" will be permanently removed. This fails if users still have this role.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await remove.mutateAsync(deleting._id);
          toast.success('Role deleted');
        }}
      />
    </div>
  );
}
