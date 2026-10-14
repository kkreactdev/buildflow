import { useState } from 'react';
import { useUsers } from '../../api/admin';
import { useBookingMutations } from '../../api/bookings';
import { useMasterOptions } from '../../api/masters';
import { useUnits } from '../../api/units';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useForm } from '../../hooks/useForm';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { toLocalInput } from '../followups/datetime';
import { EnquiryPicker } from '../sitevisits/Pickers';
import '../sitevisits/sitevisits.css';
import './bookings.css';

/** Search-and-pick ONE available unit of a branch. The server searches and returns only units the user can see. */
function AvailableUnitPicker({ branchId, value, onChange }) {
  const statuses = useMasterOptions(['UNIT_STATUS']);
  const availableId = statuses.data?.UNIT_STATUS?.find((s) => s.systemKey === 'AVAILABLE')?._id;
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const results = useUnits({ search: search || undefined, branchId, statusId: availableId, limit: 8 }, { enabled: Boolean(branchId && availableId) });
  if (value) {
    return (
      <div className="chip-row">
        <span className="chip">
          {value.unitCode}{value.name ? ` · ${value.name}` : ''}
          <button type="button" aria-label="Change unit" onClick={() => onChange(null)}>×</button>
        </span>
      </div>
    );
  }
  return (
    <div>
      <Input id="bk-unit" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search available units by ID, name or address" autoComplete="off" disabled={!branchId} />
      {branchId && (
        <ul className="pick-list" aria-label="Available units">
          {(results.isPending || statuses.isPending) && <li className="pick-row muted">Loading…</li>}
          {results.data?.rows.length === 0 && <li className="pick-row muted">No available units found</li>}
          {results.data?.rows.map((u) => (
            <li key={u.id}>
              <button type="button" className="pick-row" onClick={() => onChange({ id: u.id, unitCode: u.unitCode, name: u.name })}>
                <strong>{u.unitCode}</strong> {u.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Book a unit for an enquiry: opened from a unit (pick the enquiry), from an enquiry (pick the unit), or by dropping an
 * enquiry onto the guarded Booked stage. Nothing is marked booked here: the server decides, and if someone else got the
 * unit first its refusal is shown, the screens behind are refreshed, and no success is ever claimed.
 */
export function BookingFormModal({ unit: unitAnchor, enquiry: enquiryAnchor, onClose, onBooked }) {
  const toast = useToast();
  const { can, dataScope } = usePermissions();
  const { create } = useBookingMutations();
  const [unit, setUnit] = useState(unitAnchor ?? null);
  const [enquiry, setEnquiry] = useState(enquiryAnchor ?? null);
  const branchId = enquiry?.branchId ?? unit?.branchId;
  const canPickOwner = can('users.view') && dataScope !== 'OWN';
  const users = useUsers({ branchId, isActive: 'true', limit: 100 }, { enabled: canPickOwner && Boolean(branchId) });
  const [nowLocal] = useState(() => toLocalInput(new Date()));

  const form = useForm({
    initialValues: { bookingDate: nowLocal, salespersonId: '', notes: '' },
    schema: {
      bookingDate: [rules.required('Choose the booking date'), (v) => (v && new Date(v).getTime() > Date.now() + 5 * 60_000 ? 'Choose a time that has passed' : null)],
    },
    onSubmit: async (v) => {
      if (!unit) throw new Error('Choose the unit to book');
      if (!enquiry) throw new Error('Choose the enquiry this booking is for');
      const created = await create.mutateAsync({
        unitId: unit.id, enquiryId: enquiry.id, bookingDate: new Date(v.bookingDate).toISOString(),
        ...(v.salespersonId ? { salespersonId: v.salespersonId } : {}), ...(v.notes ? { notes: v.notes } : {}),
      });
      toast.success(`Booking ${created.bookingNo} created`);
      onBooked?.(created);
      onClose();
    },
  });

  return (
    <AdminFormModal open onClose={onClose} title="Book a unit" form={form} submitLabel="Book unit" size="lg">
      <FormField label="Unit" htmlFor="bk-unit" required>
        {unitAnchor ? <strong>{unitAnchor.unitCode}{unitAnchor.name ? ` · ${unitAnchor.name}` : ''}</strong> : <AvailableUnitPicker branchId={branchId} value={unit} onChange={setUnit} />}
      </FormField>
      <FormField label="Enquiry" htmlFor="sv-enquiry" required>
        {enquiryAnchor ? <strong>{enquiryAnchor.enquiryNo} · {enquiryAnchor.name}</strong> : <EnquiryPicker value={enquiry} onChange={setEnquiry} />}
      </FormField>
      <FormField label="Booking date" htmlFor="bk-date" required error={form.errors.bookingDate} hint="When the booking was made, in your local time.">
        <Input id="bk-date" type="datetime-local" max={nowLocal} value={form.values.bookingDate} onChange={form.handleChange('bookingDate')} />
      </FormField>
      {canPickOwner && (
        <FormField label="Salesperson" htmlFor="bk-owner" hint="Defaults to whoever handles the enquiry.">
          <Select id="bk-owner" value={form.values.salespersonId} onChange={form.handleChange('salespersonId')}>
            <option value="">Default</option>
            {users.data?.rows.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label="Notes" htmlFor="bk-notes">
        <Textarea id="bk-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>
    </AdminFormModal>
  );
}
