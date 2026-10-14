import { useFollowUpMutations } from '../../api/followups';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { useMinWhen } from './datetime';

/** Complete: optional outcome. Completing never schedules another follow-up; the next one is scheduled on purpose. */
export function CompleteDialog({ followUp, onClose }) {
  const toast = useToast();
  const { complete } = useFollowUpMutations();
  const form = useForm({
    initialValues: { outcome: '' },
    onSubmit: async (v) => {
      await complete.mutateAsync({ id: followUp.id, ...(v.outcome ? { outcome: v.outcome } : {}) });
      toast.success('Follow-up completed');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Complete follow-up with ${followUp.name}`} form={form} submitLabel="Mark complete">
      <FormField label="Outcome" htmlFor="fc-outcome" hint="What happened? Optional. To follow up again, schedule a new follow-up afterwards.">
        <Textarea id="fc-outcome" rows={3} value={form.values.outcome} onChange={form.handleChange('outcome')} />
      </FormField>
    </AdminFormModal>
  );
}

export function RescheduleDialog({ followUp, onClose }) {
  const toast = useToast();
  const minWhen = useMinWhen();
  const { reschedule } = useFollowUpMutations();
  const form = useForm({
    initialValues: { when: '', reason: '' },
    schema: { when: [rules.required('Choose the new time'), (v) => (v && new Date(v).getTime() < Date.now() - 5 * 60_000 ? 'Choose a time in the future' : null)] },
    onSubmit: async (v) => {
      await reschedule.mutateAsync({ id: followUp.id, scheduledAt: new Date(v.when).toISOString(), ...(v.reason ? { reason: v.reason } : {}) });
      toast.success('Follow-up rescheduled');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Reschedule follow-up with ${followUp.name}`} form={form} submitLabel="Reschedule">
      <FormField label="New time" htmlFor="fr-when" required error={form.errors.when}>
        <Input id="fr-when" type="datetime-local" min={minWhen} value={form.values.when} onChange={form.handleChange('when')} />
      </FormField>
      <FormField label="Reason" htmlFor="fr-reason" hint="Optional. Kept in the audit log.">
        <Textarea id="fr-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

export function CancelDialog({ followUp, onClose }) {
  const toast = useToast();
  const { cancel } = useFollowUpMutations();
  const form = useForm({
    initialValues: { reason: '' },
    schema: { reason: [rules.required('Give a reason'), rules.minLength(3, 'Give a reason')] },
    onSubmit: async (v) => {
      await cancel.mutateAsync({ id: followUp.id, reason: v.reason });
      toast.success('Follow-up cancelled');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Cancel follow-up with ${followUp.name}`} form={form} submitLabel="Cancel follow-up">
      <FormField label="Reason" htmlFor="fx-reason" required error={form.errors.reason}>
        <Textarea id="fx-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}
