import { useState } from 'react';
import { useUsers } from '../../api/admin';
import { useReferralMutations } from '../../api/referrals';
import { FormField } from '../../components/ui/FormField';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { EnquiryPicker } from '../sitevisits/Pickers';

export function ReferralAssignDialog({ referral, onClose }) {
  const toast = useToast();
  const { can, userId } = usePermissions();
  const { assign } = useReferralMutations();
  const canList = can('users.view');
  const users = useUsers({ branchId: referral.branchId, isActive: 'true', limit: 100 }, { enabled: canList });
  const reassigning = Boolean(referral.assignedTo);
  const form = useForm({
    initialValues: { assignedTo: '', reason: '' },
    schema: { assignedTo: [rules.required('Choose who looks after this referral')], reason: reassigning ? [rules.required('Give a reason for reassigning')] : [] },
    onSubmit: async (v) => {
      await assign.mutateAsync({ id: referral.id, assignedTo: v.assignedTo, ...(v.reason ? { reason: v.reason } : {}) });
      toast.success('Assignment saved');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`${reassigning ? 'Reassign' : 'Assign'} ${referral.referralNo}`} form={form}>
      {reassigning && <p className="muted">Currently assigned to {referral.assignedToName ?? 'another user'}.</p>}
      <FormField label="Assign to" htmlFor="ra-user" required error={form.errors.assignedTo}>
        <Select id="ra-user" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
          <option value="">Select a person…</option>
          {(canList ? users.data?.rows ?? [] : userId ? [{ id: userId, name: 'Me' }] : []).filter((u) => u.id !== referral.assignedTo).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="ra-reason" required={reassigning} error={form.errors.reason} hint="Kept in the assignment history.">
        <Textarea id="ra-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

export function ReferralEditDialog({ referral, onClose }) {
  const toast = useToast();
  const { update } = useReferralMutations();
  const form = useForm({
    initialValues: { notes: referral.notes ?? '' },
    onSubmit: async (v) => {
      if (v.notes !== (referral.notes ?? '')) await update.mutateAsync({ id: referral.id, notes: v.notes || null });
      toast.success('Referral updated');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Edit ${referral.referralNo}`} form={form}>
      <p className="muted">Name and phone belong to the person and are edited there.</p>
      <FormField label="Notes" htmlFor="re-notes">
        <Textarea id="re-notes" rows={4} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}

/** Record that an enquiry came through this referral. It never creates the enquiry. */
export function LinkEnquiryDialog({ referral, onClose }) {
  const toast = useToast();
  const { linkEnquiry } = useReferralMutations();
  const [enquiry, setEnquiry] = useState(null);
  const form = useForm({
    initialValues: {},
    onSubmit: async () => {
      if (!enquiry) throw new Error('Choose the enquiry to link');
      await linkEnquiry.mutateAsync({ id: referral.id, enquiryId: enquiry.id });
      toast.success(`Enquiry ${enquiry.enquiryNo} linked`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Link an enquiry to ${referral.referralNo}`} form={form} submitLabel="Link enquiry">
      <FormField label="Enquiry" htmlFor="sv-enquiry" required hint="An enquiry that this referrer brought. No new enquiry is created.">
        <EnquiryPicker value={enquiry} onChange={setEnquiry} />
      </FormField>
    </AdminFormModal>
  );
}

export function UnlinkEnquiryDialog({ referral, enquiry, onClose }) {
  const toast = useToast();
  const { unlinkEnquiry } = useReferralMutations();
  const form = useForm({
    initialValues: { reason: '' },
    schema: { reason: [rules.required('Give a reason'), rules.minLength(3, 'Give a reason')] },
    onSubmit: async (v) => {
      await unlinkEnquiry.mutateAsync({ id: referral.id, enquiryId: enquiry.id, reason: v.reason.trim() });
      toast.success('Enquiry unlinked');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Unlink ${enquiry.enquiryNo}`} form={form} submitLabel="Unlink">
      <FormField label="Reason" htmlFor="ru-reason" required error={form.errors.reason}>
        <Textarea id="ru-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}
