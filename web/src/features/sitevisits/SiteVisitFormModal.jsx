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
import { toLocalInput, useMinWhen } from '../followups/datetime';
import { AddUnitModal } from '../relations/AddUnitModal';
import { EnquiryPicker, UnitPicker } from './Pickers';

const coord = (min, max, what) => (v) => (v !== '' && v != null && !Number.isNaN(Number(v)) && (Number(v) < min || Number(v) > max) ? `${what} must be between ${min} and ${max}` : null);

/**
 * Schedule a visit (for the given enquiry, one picked here, or one of a client's enquiries) or edit a
 * scheduled one. The server decides what is allowed; the stage of the enquiry moves as a consequence
 * of scheduling, never by choice here.
 *
 * `defaultWhen` (a `YYYY-MM-DD` local date, e.g. from a calendar day cell) prefills the DATE part of the
 * datetime input. The time of day is left to the user: the calendar proposes a day, it never invents a time.
 *
 * `clientId` says whose units the picker offers. `enquiries` (the client's own, already loaded) turns the
 * enquiry field into a closed list instead of a global search — scheduling from a client page must stay
 * inside that client. With neither, the modal is standalone and behaves exactly as before.
 */
export function SiteVisitFormModal({ enquiry: anchor, clientId, enquiries, visit, defaultWhen, onClose, onCreated }) {
  const toast = useToast();
  const { can, dataScope } = usePermissions();
  const { create, update } = useSiteVisitMutations();
  const editing = Boolean(visit);
  const minWhen = useMinWhen();
  const [enquiry, setEnquiry] = useState(anchor ?? null);
  const [units, setUnits] = useState(visit ? visit.units.map((u) => ({ id: u.id, unitCode: u.unitCode, name: u.name })) : []);
  const [linking, setLinking] = useState(false);
  const branchId = enquiry?.branchId ?? visit?.branchId;
  const canPickOwner = can('users.view') && dataScope !== 'OWN';
  const users = useUsers({ branchId, isActive: 'true', limit: 100 }, { enabled: canPickOwner && Boolean(branchId) && !editing });
  // The enquiries a NEW unit link may be recorded against: a client page's own set, the anchor enquiry,
  // or — standalone — whichever enquiry the operator just picked. That last case matters: without it the
  // empty state asks the operator to link a unit but offers no way to do it. Only open enquiries qualify
  // (a lost enquiry can take neither a visit nor a useful link).
  const linkTargets = enquiries ?? [anchor ?? enquiry].filter(Boolean);
  const linkable = linkTargets.filter((e) => !e.isArchived && e.stage?.kind !== 'LOST');

  const form = useForm({
    initialValues: {
      when: visit ? toLocalInput(new Date(visit.scheduledAt)) : defaultWhen ? `${defaultWhen}T10:00` : '', assignedTo: '', notes: visit?.notes ?? '',
      latitude: visit?.latitude != null ? String(visit.latitude) : '', longitude: visit?.longitude != null ? String(visit.longitude) : '',
    },
    schema: {
      when: [rules.required('Choose when'), (v, all) => (v && v !== all.__initialWhen && new Date(v).getTime() < Date.now() - 5 * 60_000 ? 'Choose a time in the future' : null)],
      latitude: [rules.number(), coord(-90, 90, 'Latitude'), (v, all) => (v !== '' && all.longitude === '' ? 'Enter the longitude too' : null)],
      longitude: [rules.number(), coord(-180, 180, 'Longitude'), (v, all) => (v !== '' && all.latitude === '' ? 'Enter the latitude too' : null)],
    },
    onSubmit: async (v) => {
      if (!enquiry && !editing) throw new Error('Choose the enquiry this visit is for');
      const hasCoords = v.latitude !== '' && v.longitude !== '';
      if (editing) {
        const patch = {};
        if (new Date(v.when).getTime() !== new Date(visit.scheduledAt).setSeconds(0, 0)) patch.scheduledAt = new Date(v.when).toISOString();
        const before = visit.units.map((u) => u.id).join(',');
        if (units.map((u) => u.id).join(',') !== before) patch.unitIds = units.map((u) => u.id);
        if (v.notes !== (visit.notes ?? '')) patch.notes = v.notes || null;
        if (v.latitude !== (visit.latitude != null ? String(visit.latitude) : '') || v.longitude !== (visit.longitude != null ? String(visit.longitude) : '')) {
          patch.latitude = hasCoords ? Number(v.latitude) : null;
          patch.longitude = hasCoords ? Number(v.longitude) : null;
        }
        if (Object.keys(patch).length) await update.mutateAsync({ id: visit.id, ...patch });
        toast.success('Visit updated');
      } else {
        const created = await create.mutateAsync({
          enquiryId: enquiry.id, scheduledAt: new Date(v.when).toISOString(), unitIds: units.map((u) => u.id),
          ...(v.assignedTo ? { assignedTo: v.assignedTo } : {}), ...(v.notes ? { notes: v.notes } : {}), ...(hasCoords ? { latitude: Number(v.latitude), longitude: Number(v.longitude) } : {}),
        });
        toast.success(`Site visit ${created.visitNo} scheduled`);
        onCreated?.(created);
      }
      onClose();
    },
  });

  return (
    <AdminFormModal open onClose={onClose} title={editing ? `Edit ${visit.visitNo}` : 'Schedule site visit'} form={form} submitLabel={editing ? 'Save' : 'Schedule'} size="lg">
      {!editing && (
        <FormField label="Enquiry" htmlFor="sv-enquiry" required>
          {anchor ? <strong>{anchor.enquiryNo} · {anchor.name}</strong> : enquiries ? (
            // Opened from a client page: the visit belongs to one of THIS client's enquiries, so the
            // choice is a closed list rather than a search across every enquiry the caller can see.
            <Select id="sv-enquiry" value={enquiry?.id ?? ''} onChange={(e) => setEnquiry(linkable.find((x) => x.id === e.target.value) ?? null)}>
              <option value="">Choose an enquiry…</option>
              {linkable.map((e) => <option key={e.id} value={e.id}>{e.enquiryNo} · {e.name}</option>)}
            </Select>
          ) : <EnquiryPicker value={enquiry} onChange={setEnquiry} />}
        </FormField>
      )}
      <FormField label="When" htmlFor="sv-when" required error={form.errors.when}>
        <Input id="sv-when" type="datetime-local" min={editing ? undefined : minWhen} value={form.values.when} onChange={form.handleChange('when')} />
      </FormField>
      {(enquiry || editing) && (
        <FormField
          label="Units"
          htmlFor="sv-units"
          hint={clientId
            ? "This client's linked units, across all of their enquiries."
            : 'The units linked to this enquiry. Scheduling a visit does not change a unit.'}
        >
          <UnitPicker
            // Editing keeps the same rule: the visit's OWN enquiry is the party whose units are listed,
            // so a unit that was linked through this very visit is still offered.
            enquiryId={enquiry?.id ?? visit?.enquiryId}
            clientId={editing ? undefined : clientId}
            branchId={branchId}
            value={units}
            onChange={setUnits}
            onLinkUnit={!editing && can('enquiries.edit') && linkable.length ? () => setLinking(true) : undefined}
          />
        </FormField>
      )}
      {!editing && canPickOwner && (
        <FormField label="Visit by" htmlFor="sv-owner" hint="Defaults to whoever handles the enquiry.">
          <Select id="sv-owner" value={form.values.assignedTo} onChange={form.handleChange('assignedTo')}>
            <option value="">Default</option>
            {users.data?.rows.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
      )}
      <div className="unit-grid-2">
        <FormField label="Latitude" htmlFor="sv-lat" error={form.errors.latitude}>
          <Input id="sv-lat" type="number" step="any" value={form.values.latitude} onChange={form.handleChange('latitude')} />
        </FormField>
        <FormField label="Longitude" htmlFor="sv-lng" error={form.errors.longitude}>
          <Input id="sv-lng" type="number" step="any" value={form.values.longitude} onChange={form.handleChange('longitude')} />
        </FormField>
      </div>
      <FormField label="Notes" htmlFor="sv-notes">
        <Textarea id="sv-notes" rows={3} value={form.values.notes} onChange={form.handleChange('notes')} />
      </FormField>

      {/* The escape hatch when nothing is linked yet: the EXISTING Add-unit workflow, opened on the
          enquiry being scheduled. It records an interest — it never books or changes a unit's status —
          and the linked-units query is invalidated by its own mutation, so the picker fills in. */}
      {linking && (
        <AddUnitModal
          enquiries={[...(enquiry ? [enquiry] : []), ...linkable.filter((e) => !enquiry || e.id !== enquiry.id)]}
          onClose={() => setLinking(false)}
        />
      )}
    </AdminFormModal>
  );
}
