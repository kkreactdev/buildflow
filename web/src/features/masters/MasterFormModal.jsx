import { useBranches } from '../../api/admin';
import { useMasterMutations } from '../../api/masters';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import './masters.css';

export function MasterFormModal({ def, value, defaultBranchId, onClose }) {
  const toast = useToast();
  const { branchIds } = usePermissions();
  const branches = useBranches();
  const { create, update } = useMasterMutations(def.key);
  const editing = Boolean(value);
  const isSystem = Boolean(value?.systemKey);
  const branchScoped = def.scope === 'BRANCH';

  const form = useForm({
    initialValues: {
      label: value?.label ?? '',
      code: '',
      description: value?.description ?? '',
      color: value?.color ?? '#3f6690',
      branchId: value?.branchId ?? defaultBranchId ?? (branchIds.length === 1 ? branchIds[0] : ''),
      isActive: value?.isActive ?? true,
    },
    schema: {
      label: [rules.required('Enter a name'), rules.maxLength(80)],
      code: [(v) => (v && !/^[A-Za-z][A-Za-z0-9_]{1,39}$/.test(v) ? 'Letters, digits and _ only, starting with a letter' : null)],
      branchId: branchScoped && !editing ? [rules.required('Choose a branch')] : [],
    },
    onSubmit: async (v) => {
      if (editing) {
        await update.mutateAsync({
          id: value._id,
          label: v.label,
          description: v.description || null,
          ...(def.hasColor ? { color: v.color } : {}),
          ...(isSystem ? {} : { isActive: v.isActive }),
        });
      } else {
        await create.mutateAsync({
          label: v.label,
          ...(v.code ? { code: v.code } : {}),
          ...(v.description ? { description: v.description } : {}),
          ...(def.hasColor ? { color: v.color } : {}),
          ...(branchScoped ? { branchId: v.branchId } : {}),
        });
      }
      toast.success(editing ? 'Saved' : 'Created');
      onClose();
    },
  });

  const singular = def.label.replace(/s$/, '');
  return (
    <AdminFormModal open onClose={onClose} title={editing ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`} form={form}>
      <FormField label="Name" htmlFor="m-label" required error={form.errors.label}>
        <Input id="m-label" autoFocus value={form.values.label} onChange={form.handleChange('label')} />
      </FormField>
      {editing ? (
        <FormField label={isSystem ? 'System key (fixed)' : 'Code (fixed)'} hint={isSystem ? 'Required by the system; the name and colour can still be changed.' : undefined}>
          <div className="key-box">{value.systemKey ?? value.code}</div>
        </FormField>
      ) : (
        <FormField label="Code" htmlFor="m-code" hint="Optional. Generated from the name if left empty; cannot be changed later." error={form.errors.code}>
          <Input id="m-code" value={form.values.code} onChange={form.handleChange('code')} />
        </FormField>
      )}
      {branchScoped && (
        <FormField label="Branch" htmlFor="m-branch" required={!editing} error={form.errors.branchId} hint={editing ? 'A value cannot move to another branch.' : undefined}>
          <Select id="m-branch" disabled={editing} value={form.values.branchId} onChange={form.handleChange('branchId')}>
            <option value="">Select a branch…</option>
            {branches.data?.rows.filter((b) => b.isActive || b._id === form.values.branchId).map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField label="Description" htmlFor="m-desc">
        <Input id="m-desc" value={form.values.description} onChange={form.handleChange('description')} />
      </FormField>
      {def.hasColor && (
        <FormField label="Colour" htmlFor="m-color">
          <input id="m-color" type="color" value={form.values.color} onChange={form.handleChange('color')} />
        </FormField>
      )}
      {editing && !isSystem && (
        <label className="check-item">
          <input type="checkbox" checked={form.values.isActive} onChange={form.handleChange('isActive')} />
          Active (selectable for new records)
        </label>
      )}
    </AdminFormModal>
  );
}
