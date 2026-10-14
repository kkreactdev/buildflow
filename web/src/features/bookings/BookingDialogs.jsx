import { useBookingMutations } from '../../api/bookings';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { toLocalInput } from '../followups/datetime';
import './bookings.css';

/** Release needs a reason. The booking stays as history and the unit becomes available again. */
export function ReleaseDialog({ booking, onClose }) {
  const toast = useToast();
  const { release } = useBookingMutations();
  const form = useForm({
    initialValues: { reason: '' },
    schema: { reason: [rules.required('Give a reason'), rules.minLength(3, 'Give a reason')] },
    onSubmit: async (v) => {
      await release.mutateAsync({ id: booking.id, reason: v.reason.trim() });
      toast.success(`Booking ${booking.bookingNo} released`);
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Release ${booking.bookingNo}`} form={form} submitLabel="Release booking">
      <p className="muted">{booking.unitCode} becomes available again. The booking is kept as history.</p>
      <FormField label="Reason" htmlFor="rb-reason" required error={form.errors.reason}>
        <Textarea id="rb-reason" rows={3} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}

/** Edit the date and notes of an ACTIVE booking (only what changed is sent). */
export function BookingEditModal({ booking, onClose }) {
  const toast = useToast();
  const { update } = useBookingMutations();
  const initialDate = toLocalInput(new Date(booking.bookingDate));
  const form = useForm({
    initialValues: { bookingDate: initialDate, notes: booking.notes ?? '' },
    schema: { bookingDate: [rules.required('Choose the booking date'), (v) => (v && new Date(v).getTime() > Date.now() + 5 * 60_000 ? 'Choose a time that has passed' : null)] },
    onSubmit: async (v) => {
      const patch = {};
      if (v.bookingDate !== initialDate) patch.bookingDate = new Date(v.bookingDate).toISOString();
      if (v.notes !== (booking.notes ?? '')) patch.notes = v.notes || null;
      if (Object.keys(patch).length) await update.mutateAsync({ id: booking.id, ...patch });
      toast.success('Booking updated');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Edit ${booking.bookingNo}`} form={form}>
      <FormField label="Booking date" htmlFor="eb-date" required error={form.errors.bookingDate}>
        <Input id="eb-date" type="datetime-local" value={form.values.bookingDate} onChange={form.handleChange('bookingDate')} />
      </FormField>
      <FormField label="Notes" htmlFor="eb-notes">
        <Textarea id="eb-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}

/** Manager decision on a lost booking attempt: keep the holder, or replace it (reason required). */
export function ResolveConflictDialog({ conflict, onClose }) {
  const toast = useToast();
  const { resolve } = useBookingMutations();
  const form = useForm({
    initialValues: { resolution: 'KEEP_EXISTING', reason: '' },
    schema: { reason: [(v, all) => (all.resolution === 'REPLACE' && !String(v ?? '').trim() ? 'Give a reason for replacing the booking' : null)] },
    onSubmit: async (v) => {
      await resolve.mutateAsync({ id: conflict.id, resolution: v.resolution, ...(v.reason.trim() ? { reason: v.reason.trim() } : {}) });
      toast.success(v.resolution === 'REPLACE' ? 'Booking replaced' : 'Conflict resolved');
      onClose();
    },
  });
  return (
    <AdminFormModal open onClose={onClose} title={`Resolve conflict on ${conflict.unitCode}`} form={form} submitLabel="Resolve">
      <p className="muted">{conflict.attemptedByName ?? 'Someone'} tried to book {conflict.unitCode} for {conflict.attemptedPersonName} ({conflict.attemptedEnquiryNo}) but it was already booked{conflict.existingBookingNo ? ` (${conflict.existingBookingNo})` : ''}.</p>
      <label className="radio-row">
        <input type="radio" name="resolution" checked={form.values.resolution === 'KEEP_EXISTING'} onChange={() => form.handleChange('resolution')('KEEP_EXISTING')} />
        <span><strong>Keep the existing booking</strong><br /><span className="muted">The attempt is closed; nothing else changes.</span></span>
      </label>
      <label className="radio-row">
        <input type="radio" name="resolution" checked={form.values.resolution === 'REPLACE'} onChange={() => form.handleChange('resolution')('REPLACE')} />
        <span><strong>Replace it with this booking</strong><br /><span className="muted">Releases the existing booking and books the unit for {conflict.attemptedPersonName}.</span></span>
      </label>
      <FormField label="Reason" htmlFor="rc-reason" required={form.values.resolution === 'REPLACE'} error={form.errors.reason} hint="Kept in the audit log.">
        <Textarea id="rc-reason" rows={2} value={form.values.reason} onChange={form.handleChange('reason')} />
      </FormField>
    </AdminFormModal>
  );
}
