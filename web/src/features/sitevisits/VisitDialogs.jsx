import { useState } from 'react';
import { useUsers } from '../../api/admin';
import { useSiteVisitMutations } from '../../api/sitevisits';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { toLocalInput } from '../followups/datetime';

const coord = (min, max, what) => (v) => (v !== '' && v != null && !Number.isNaN(Number(v)) && (Number(v) < min || Number(v) > max) ? `${what} must be between ${min} and ${max}` : null);

/** Complete: feedback is required. The server also moves the enquiry on and schedules ONE follow-up for the next day. */
export function CompleteVisitDialog({ visit, onClose }) {
  const toast = useToast();
  const { complete } = useSiteVisitMutations();
  const [nowLocal] = useState(() => toLocalInput(new Date()));
  const form = useForm({
    initialValues: { feedback: '', notes: '', completedAt: '', latitude: '', longitude: '' },
    schema: {
      feedback: [rules.required('Record the visit feedback')],
      latitude: [rules.number(), coord(-90, 90, 'Latitude'), (v, all) => (v !== '' && all.longitude === '' ? 'Enter the longitude too' : null)],
      longitude: [rules.number(), coord(-180, 180, 'Longitude'), (v, all) => (v !== '' && all.latitude === '' ? 'Enter the latitude too' : null)],
      completedAt: [(v) => (v && new Date(v).getTime() > Date.now() + 5 * 60_000 ? 'Choose a time that has passed' : null)],
    },
    onSubmit: async (v) => {
      await complete.mutateAsync({
        id: visit.id, feedback: v.feedback.trim(), ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
        ...(v.completedAt ? { completedAt: new Date(v.completedAt).toISOString() } : {}),
        ...(v.latitude !== '' ? { latitude: Number(v.latitude), longitude: Number(v.longitude) } : {}),
      });
      toast.success('Site visit completed. A follow-up was scheduled for tomorrow.');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Complete ${visit.visitNo}`} form={form} submitLabel="Mark complete" size="lg">
      <p className="muted">Completing moves the enquiry on and schedules one follow-up for the next day.</p>
      <FormField label="Feedback" htmlFor="cv-feedback" required error={form.errors.feedback} hint="How did the visit go?">
        <Textarea id="cv-feedback" rows={3} value={form.values.feedback} onChange={form.handleChange('feedback')} />
      </FormField>
      <FormField label="Notes" htmlFor="cv-notes">
        <Textarea id="cv-notes" rows={2} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
      <FormField label="Completed at" htmlFor="cv-at" error={form.errors.completedAt} hint="Leave empty for now.">
        <Input id="cv-at" type="datetime-local" max={nowLocal} value={form.values.completedAt} onChange={form.handleChange('completedAt')} />
      </FormField>
      <div className="unit-grid-2">
        <FormField label="Visit latitude" htmlFor="cv-lat" error={form.errors.latitude}>
          <Input id="cv-lat" type="number" step="any" value={form.values.latitude} onChange={form.handleChange('latitude')} />
        </FormField>
        <FormField label="Visit longitude" htmlFor="cv-lng" error={form.errors.longitude}>
          <Input id="cv-lng" type="number" step="any" value={form.values.longitude} onChange={form.handleChange('longitude')} />
        </FormField>
      </div>
    </AdminFormModal>
  );
}

export function CancelVisitDialog({ visit, onClose }) {
  const toast = useToast();
  const { cancel } = useSiteVisitMutations();
  const form = useForm({
    initialValues: { reason: '' },
    schema: { reason: [rules.required('Give a reason')] },
    onSubmit: async (v) => {
      await cancel.mutateAsync({ id: visit.id, reason: v.reason.trim() });
      toast.success('Site visit cancelled');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Cancel ${visit.visitNo}`} form={form} submitLabel="Cancel visit">
      <FormField label="Reason" htmlFor="xv-reason" required error={form.errors.reason}>
        <Textarea id="xv-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

/** Reassign the visit. A reason is required; candidates are active users of the visit's branch. */
export function AssignVisitDialog({ visit, onClose }) {
  const toast = useToast();
  const { can, userId } = usePermissions();
  const { assign } = useSiteVisitMutations();
  const canList = can('users.view');
  const users = useUsers({ branchId: visit.branchId, isActive: 'true', limit: 100 }, { enabled: canList });
  const form = useForm({
    initialValues: { assignedTo: '', reason: '' },
    schema: { assignedTo: [rules.required('Choose who will do the visit')], reason: [rules.required('Give a reason for reassigning')] },
    onSubmit: async (v) => {
      await assign.mutateAsync({ id: visit.id, assignedTo: v.assignedTo, reason: v.reason.trim() });
      toast.success('Assignment saved');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Reassign ${visit.visitNo}`} form={form}>
      <p className="muted">Currently assigned to {visit.assignedToName ?? 'another user'}.</p>
      <FormField label="Visit by" htmlFor="av-user" required error={form.errors.assignedTo}>
        <Select id="av-user" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
          <option value="">Select a person…</option>
          {(canList ? users.data?.rows ?? [] : userId ? [{ id: userId, name: 'Me' }] : []).filter((u) => u.id !== visit.assignedTo).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="av-reason" required error={form.errors.reason} hint="Kept in the assignment history.">
        <Textarea id="av-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}
