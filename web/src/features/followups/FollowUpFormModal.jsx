import { useUsers } from '../../api/admin';
import { useFollowUpMutations } from '../../api/followups';
import { MasterSelect } from '../../components/data/MasterSelect';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { useMinWhen } from './datetime';

/**
 * Schedule (create) or edit a follow-up. The time is chosen here only when scheduling; moving it later is
 * the separate "Reschedule" action so it is recorded as such. Type options come from the FOLLOWUP_TYPE master.
 */
export function FollowUpFormModal({ anchor, followUp, branchId, onClose }) {
  const toast = useToast();
  const { can, dataScope } = usePermissions();
  const { create, update } = useFollowUpMutations();
  const editing = Boolean(followUp);
  const minWhen = useMinWhen();
  const canPickOwner = can('users.view') && dataScope !== 'OWN';
  const users = useUsers({ branchId, isActive: 'true', limit: 100 }, { enabled: canPickOwner && Boolean(branchId) });

  const form = useForm({
    initialValues: { typeId: followUp?.typeId ?? '', when: '', assignedTo: followUp?.assignedTo ?? '', notes: followUp?.notes ?? '' },
    schema: {
      typeId: [rules.required('Choose a type')],
      when: editing ? [] : [rules.required('Choose when'), (v) => (v && new Date(v).getTime() < Date.now() - 5 * 60_000 ? 'Choose a time in the future' : null)],
    },
    onSubmit: async (v) => {
      if (editing) {
        const patch = {};
        if (v.typeId !== followUp.typeId) patch.typeId = v.typeId;
        if (v.assignedTo && v.assignedTo !== followUp.assignedTo) patch.assignedTo = v.assignedTo;
        if (v.notes !== (followUp.notes ?? '')) patch.notes = v.notes || null;
        if (Object.keys(patch).length) await update.mutateAsync({ id: followUp.id, ...patch });
        toast.success('Follow-up updated');
      } else {
        await create.mutateAsync({ ...anchor, typeId: v.typeId, scheduledAt: new Date(v.when).toISOString(), ...(v.assignedTo ? { assignedTo: v.assignedTo } : {}), ...(v.notes ? { notes: v.notes } : {}) });
        toast.success('Follow-up scheduled');
      }
      onClose();
    },
  });

  return (
    <AdminFormModal open onClose={onClose} title={editing ? 'Edit follow-up' : 'Schedule follow-up'} form={form} submitLabel={editing ? 'Save' : 'Schedule'}>
      <FormField label="Type" htmlFor="fu-type" required error={form.errors.typeId}>
        <MasterSelect id="fu-type" type="FOLLOWUP_TYPE" value={form.values.typeId} onChange={form.handleChange('typeId')} placeholder="Select type…" />
      </FormField>
      {!editing && (
        <FormField label="When" htmlFor="fu-when" required error={form.errors.when}>
          <Input id="fu-when" type="datetime-local" min={minWhen} value={form.values.when} onChange={form.handleChange('when')} />
        </FormField>
      )}
      {canPickOwner && (
        <FormField label="Assigned to" htmlFor="fu-owner" hint={editing ? undefined : 'Defaults to whoever handles this record.'}>
          <Select id="fu-owner" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
            <option value="">{editing ? 'Keep current' : 'Default'}</option>
            {users.data?.rows.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label="Notes" htmlFor="fu-notes">
        <Textarea id="fu-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}
