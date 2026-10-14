import { useUsers } from '../../api/admin';
import { useMasterOptions } from '../../api/masters';
import { useUnitMutations } from '../../api/units';
import { FormField } from '../../components/ui/FormField';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';

/** Assign / reassign the unit's one current salesperson. Candidates are active users of the unit's branch; a reason is required to reassign. */
export function UnitAssignDialog({ unit, onClose }) {
  const toast = useToast();
  const { can, userId } = usePermissions();
  const { assign } = useUnitMutations();
  const canList = can('users.view');
  const users = useUsers({ branchId: unit.branchId, isActive: 'true', limit: 100 }, { enabled: canList });
  const reassigning = Boolean(unit.assignedTo);

  const form = useForm({
    initialValues: { assignedTo: '', reason: '' },
    schema: { assignedTo: [rules.required('Choose the salesperson')], reason: reassigning ? [rules.required('Give a reason for reassigning')] : [] },
    onSubmit: async (v) => {
      await assign.mutateAsync({ id: unit.id, assignedTo: v.assignedTo, ...(v.reason ? { reason: v.reason } : {}) });
      toast.success('Assignment saved');
      onClose();
    },
  });

  return (
    <AdminFormModal open onClose={onClose} title={`${reassigning ? 'Reassign' : 'Assign'} ${unit.unitCode}`} form={form}>
      {reassigning && <p className="muted">Currently assigned to {unit.assignedToName ?? 'another user'}.</p>}
      <FormField label="Salesperson" htmlFor="ua-user" required error={form.errors.assignedTo}>
        <Select id="ua-user" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
          <option value="">Select a person…</option>
          {(canList ? users.data?.rows ?? [] : userId ? [{ id: userId, name: 'Me' }] : []).filter((u) => u.id !== unit.assignedTo).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="ua-reason" required={reassigning} error={form.errors.reason} hint="Kept in the assignment history.">
        <Textarea id="ua-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

/** Change status. Options are the UNIT_STATUS master; booked status belongs to bookings and is not offered. The server decides what is allowed. */
export function UnitStatusDialog({ unit, onClose }) {
  const toast = useToast();
  const { setStatus } = useUnitMutations();
  const statuses = useMasterOptions(['UNIT_STATUS']);
  const options = (statuses.data?.UNIT_STATUS ?? []).filter((s) => s._id !== unit.statusId && s.systemKey !== 'BOOKED');

  const form = useForm({
    initialValues: { statusId: '', reason: '' },
    schema: { statusId: [rules.required('Choose the new status')] },
    onSubmit: async (v) => {
      await setStatus.mutateAsync({ id: unit.id, statusId: v.statusId, from: unit.statusId, ...(v.reason ? { reason: v.reason } : {}) });
      toast.success('Status updated');
      onClose();
    },
  });

  return (
    <AdminFormModal open onClose={onClose} title={`Change status of ${unit.unitCode}`} form={form}>
      <p className="muted">Currently {unit.status?.label ?? unit.statusKey}.</p>
      <FormField label="New status" htmlFor="us-status" required error={form.errors.statusId}>
        <Select id="us-status" value={form.values.statusId} onChange={form.handleChange('statusId')} disabled={statuses.isPending}>
          <option value="">{statuses.isPending ? 'Loading…' : 'Select a status…'}</option>
          {options.map((s) => <option key={s._id} value={s._id}>{s.label}</option>)}
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="us-reason" hint="Optional. Kept in the audit log.">
        <Textarea id="us-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}
