import { useState } from 'react';
import { useEligibleUnitsForEnquiry, useUnitInterestMutations } from '../../api/relations';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { SearchIcon } from '../../components/ui/icons';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Textarea } from '../../components/ui/Textarea';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useToast } from '../../hooks/useToast';
import { formatInr } from '../../lib/format';
import { UnitStatusPill } from '../units/UnitStatusPill';
import { STATUS_CHOICES } from './labels';

/**
 * Add a unit to an enquiry: pick a unit the server says is ELIGIBLE right now (Available, or an
 * expired hold, with no ACTIVE booking), say how the person relates to it, optionally add a note.
 * Only Interested and Not interested are recorded by hand; the other relationships follow from
 * visits, bookings and sales and are shown disabled with the reason. Nothing here reserves or
 * books a unit, and the unit's own inventory status is shown only for information.
 *
 * `enquiries` lets a client page choose which enquiry the unit belongs to; `taken` maps enquiryId
 * to unit ids already linked (those are still SELECTABLE — multiple enquiries may share an
 * available unit — but the row shows "Already added" so the operator can spot duplicates).
 */
export function AddUnitModal({ enquiries, taken = {}, onClose }) {
  const toast = useToast();
  const { add } = useUnitInterestMutations();
  const [enquiryId, setEnquiryId] = useState(enquiries[0].id);
  const [unit, setUnit] = useState(null);
  const [status, setStatus] = useState('INTERESTED');
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const term = useDebouncedValue(text.trim(), 300);
  const enquiry = enquiries.find((e) => e.id === enquiryId) ?? enquiries[0];
  // Server filters out SOLD / booked / on-hold / archived units. The same rules are re-checked
  // on the create call, so a stale picker still fails safely with a clear, refreshable error.
  const units = useEligibleUnitsForEnquiry(enquiryId, { search: term || undefined, limit: 6 }, { enabled: Boolean(enquiryId) });
  const linked = new Set(taken[enquiryId] ?? []);

  async function submit() {
    if (!unit) { setError('Choose a unit'); return; }
    setError(null);
    setBusy(true);
    try {
      await add.mutateAsync({ enquiryId, unitId: unit.id, status, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(`${unit.unitCode} added`);
      onClose();
    } catch (err) {
      // If the unit became ineligible between picker and submit, the API returns UNIT_NOT_ELIGIBLE
      // with a friendly message. Drop the chosen unit so the picker shows the current list, refresh
      // it, and surface the server's explanation instead of a generic network-style error.
      setError(err.message);
      if (err.code === 'UNIT_NOT_ELIGIBLE') {
        setUnit(null);
        units.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Add unit" subtitle={`${enquiry.enquiryNo} · ${enquiry.name}`} size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy || !unit}>{busy ? 'Adding…' : 'Add unit'}</Button></>}>
      <p className="muted">This records how the person relates to the unit. It does not reserve or book it.</p>
      {enquiries.length > 1 && (
        <FormField label="Enquiry" htmlFor="au-enquiry">
          <Select id="au-enquiry" value={enquiryId} onChange={(e) => { setEnquiryId(e.target.value); setUnit(null); }}>
            {enquiries.map((e) => <option key={e.id} value={e.id}>{e.enquiryNo}{e.stage?.label ? ` · ${e.stage.label}` : ''}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label="Unit" htmlFor="au-search" required>
        {unit ? (
          <div className="chip-row"><span className="chip">{unit.unitCode} · {unit.name}<button type="button" aria-label="Change unit" onClick={() => setUnit(null)}>×</button></span></div>
        ) : (
          <>
            <label className="search-input"><SearchIcon size={16} /><input id="au-search" type="search" aria-label="Search units" placeholder="Search by unit ID, name or location" value={text} onChange={(e) => setText(e.target.value)} /></label>
            {units.isPending && <Skeleton height={44} />}
            {units.isError && <p className="form-error" role="alert">{units.error.message}</p>}
            {units.data?.rows.length === 0 && !units.isPending && <p className="muted">No available units match.</p>}
            <ul className="unit-pick-list" aria-label="Units">
              {units.data?.rows.map((u) => (
                <li key={u.id} className="unit-pick">
                  <div>
                    <strong>{u.unitCode}</strong> · {u.name} <UnitStatusPill unit={u} />
                    <div className="muted">{[u.location?.label, u.city, u.propertyType?.label, u.expectedPrice != null ? formatInr(u.expectedPrice) : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Button variant="secondary" disabled={linked.has(u.id)} onClick={() => setUnit(u)}>{linked.has(u.id) ? 'Already added' : 'Select'}</Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </FormField>
      <FormField label="Relationship" htmlFor="au-status" hint="Only Interested and Not interested are set by hand; the rest follow from visits, bookings and sales.">
        <Select id="au-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_CHOICES.map((c) => <option key={c.value} value={c.value} disabled={c.disabled}>{c.label}</option>)}
        </Select>
      </FormField>
      <FormField label="Notes" htmlFor="au-note">
        <Textarea id="au-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </FormField>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
