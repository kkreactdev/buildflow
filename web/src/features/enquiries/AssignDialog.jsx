import { useUsers } from '../../api/admin';
import { useEnquiryMutations } from '../../api/enquiries';
import { FormField } from '../../components/ui/FormField';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';

/** Assign / reassign. Candidates are active users of the enquiry's branch; a reason is required to reassign. */
export function AssignDialog({ enquiry, onClose }) {
  const toast = useToast();
  const { can, userId } = usePermissions();
  const { assign } = useEnquiryMutations();
  const canList = can('users.view');
  const users = useUsers({ branchId: enquiry.branchId, isActive: 'true', limit: 100 }, { enabled: canList });
  const reassigning = Boolean(enquiry.assignedTo);

  const form = useForm({
    initialValues: { assignedTo: '', reason: '' },
    schema: { assignedTo: [rules.required('Choose who should own this enquiry')], reason: reassigning ? [rules.required('Give a reason for reassigning')] : [] },
    onSubmit: async (v) => {
      await assign.mutateAsync({ id: enquiry.id, assignedTo: v.assignedTo, ...(v.reason ? { reason: v.reason } : {}) });
      toast.success('Assignment saved');
      onClose();
    },
  });

  return (
    <AdminFormModal open onClose={onClose} title={`${reassigning ? 'Reassign' : 'Assign'} ${enquiry.enquiryNo}`} form={form}>
      {reassigning && <p className="muted">Currently assigned to {enquiry.assignedToName ?? 'another user'}.</p>}
      <FormField label="Assign to" htmlFor="as-user" required error={form.errors.assignedTo}>
        <Select id="as-user" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
          <option value="">Select a person…</option>
          {(canList ? users.data?.rows ?? [] : userId ? [{ id: userId, name: 'Me' }] : []).filter((u) => u.id !== enquiry.assignedTo).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="as-reason" required={reassigning} error={form.errors.reason} hint="Kept in the assignment history.">
        <Textarea id="as-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}
