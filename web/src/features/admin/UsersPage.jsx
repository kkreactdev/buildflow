import { useState } from 'react';
import { ReferralCreateModal } from '../referrals/ReferralCreateModal';
import { useBranches, useRoles, useUserMutations, useUsers } from '../../api/admin';
import { DataTable } from '../../components/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/data/FilterBar';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../hooks/useToast';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useTableState } from '../../hooks/useTableState';
import { formatRelativeTime } from '../../lib/format';
import { rules } from '../../lib/validation';
import { AdminFormModal } from './AdminFormModal';
import './admin.css';

const FILTER_KEYS = ['roleId', 'isActive'];

function UserForm({ user, onClose }) {
  const toast = useToast();
  const roles = useRoles();
  const branches = useBranches();
  const { create, update } = useUserMutations();
  const editing = Boolean(user);

  const form = useForm({
    initialValues: {
      name: user?.name ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      password: '',
      roleId: user?.roleId ?? '',
      branchIds: user?.branchIds ?? [],
      isActive: user?.isActive ?? true,
    },
    schema: {
      name: [rules.required(), rules.minLength(2)],
      email: [rules.required(), rules.email()],
      phone: [rules.phone()],
      password: editing ? [rules.minLength(10, 'At least 10 characters')] : [rules.required(), rules.minLength(10, 'At least 10 characters')],
      roleId: [rules.required('Select a role')],
    },
    onSubmit: async (v) => {
      const body = { name: v.name, email: v.email, roleId: v.roleId, branchIds: v.branchIds };
      if (editing) {
        await update.mutateAsync({ id: user.id, ...body, phone: v.phone || null, isActive: v.isActive, ...(v.password ? { password: v.password } : {}) });
      } else {
        await create.mutateAsync({ ...body, password: v.password, ...(v.phone ? { phone: v.phone } : {}) });
      }
      toast.success(editing ? 'User updated' : 'User created');
      onClose();
    },
  });

  const toggleBranch = (id) =>
    form.setValue('branchIds', form.values.branchIds.includes(id) ? form.values.branchIds.filter((b) => b !== id) : [...form.values.branchIds, id]);

  return (
    <AdminFormModal open onClose={onClose} title={editing ? 'Edit user' : 'New user'} form={form}>
      <FormField label="Name" htmlFor="u-name" required error={form.errors.name}>
        <Input id="u-name" value={form.values.name} onChange={form.handleChange('name')} />
      </FormField>
      <FormField label="Email" htmlFor="u-email" required error={form.errors.email}>
        <Input id="u-email" type="email" value={form.values.email} onChange={form.handleChange('email')} />
      </FormField>
      <FormField label="Phone" htmlFor="u-phone" error={form.errors.phone}>
        <Input id="u-phone" value={form.values.phone} onChange={form.handleChange('phone')} />
      </FormField>
      <FormField
        label={editing ? 'New password' : 'Password'}
        htmlFor="u-pass"
        required={!editing}
        hint={editing ? 'Leave blank to keep the current password. Changing it signs the user out everywhere.' : 'At least 10 characters'}
        error={form.errors.password}
      >
        <Input id="u-pass" type="password" autoComplete="new-password" value={form.values.password} onChange={form.handleChange('password')} />
      </FormField>
      <FormField label="Role" htmlFor="u-role" required error={form.errors.roleId}>
        <Select id="u-role" value={form.values.roleId} onChange={form.handleChange('roleId')}>
          <option value="">Select a role…</option>
          {roles.data?.rows.filter((r) => r.isActive).map((r) => (
            <option key={r._id} value={r._id}>
              {r.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Branches" hint="Roles with a branch-limited scope need at least one branch." error={form.errors.branchIds}>
        <div className="check-list">
          {branches.data?.rows.filter((b) => b.isActive).map((b) => (
            <label key={b._id} className="check-item">
              <input type="checkbox" checked={form.values.branchIds.includes(b._id)} onChange={() => toggleBranch(b._id)} />
              {b.name}
            </label>
          ))}
          {branches.data?.rows.length === 0 && <span className="muted">No branches yet.</span>}
        </div>
      </FormField>
      {editing && (
        <label className="check-item">
          <input type="checkbox" checked={form.values.isActive} onChange={form.handleChange('isActive')} />
          Active (can sign in)
        </label>
      )}
    </AdminFormModal>
  );
}

export function UsersPage() {
  const { can } = usePermissions();
  const table = useTableState({ defaultSort: 'name', filterKeys: FILTER_KEYS });
  const query = useUsers(table.params);
  const roles = useRoles();
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [referrer, setReferrer] = useState(null);

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'roleName', header: 'Role' },
    { key: 'branchIds', header: 'Branches', render: (u) => u.branchIds.length || '—' },
    { key: 'isActive', header: 'Status', render: (u) => <Pill label={u.isActive ? 'Active' : 'Inactive'} size="sm" color={u.isActive ? 'var(--success)' : 'var(--danger)'} bg={u.isActive ? 'var(--success-soft)' : 'var(--danger-soft)'} /> },
    { key: 'lastLoginAt', header: 'Last sign-in', sortable: true, render: (u) => (u.lastLoginAt ? formatRelativeTime(u.lastLoginAt) : 'Never') },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Users</h2>
        {can('users.create') && <Button onClick={() => setEditing('new')}>New user</Button>}
      </div>
      <FilterBar search={table.params.search} onSearch={table.setSearch} searchPlaceholder="Search name, email, phone" onReset={table.reset} canReset={table.hasActiveFilters}>
        <FilterSelect label="Role" value={table.params.roleId} onChange={(v) => table.setFilter('roleId', v)} options={(roles.data?.rows ?? []).map((r) => ({ value: r._id, label: r.name }))} loading={roles.isPending} />
        <FilterSelect label="Status" value={table.params.isActive} onChange={(v) => table.setFilter('isActive', v)} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} allLabel="Any" />
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
        getRowId={(u) => u.id}
        rowActions={(u) => <ActionMenu items={[{ label: 'Edit', hidden: !can('users.edit'), onSelect: () => setEditing(u) }, { label: 'Make referrer…', hidden: !can('referrals.create') || !u.isActive, onSelect: () => setReferrer(u) }]} />}
        empty={{ title: 'No users found', description: 'Try clearing the filters.' }}
      />
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {referrer && <ReferralCreateModal initial={{ flow: 'employee', employee: { id: referrer.id, name: referrer.name } }} onClose={() => setReferrer(null)} />}
    </div>
  );
}
