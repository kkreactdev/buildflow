import { useState } from 'react';
import { useEnquiries } from '../../api/enquiries';
import { useClientLinkedUnits, useEnquiryLinkedUnits } from '../../api/relations';
import { useUnits } from '../../api/units';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { StatusPill } from '../../components/ui/StatusPill';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { StatePill } from '../relations/RelationPill';
import './sitevisits.css';

/** Search-and-pick one enquiry. Search runs on the server; only enquiries the user can see are returned. */
export function EnquiryPicker({ value, onChange, id = 'sv-enquiry' }) {
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const results = useEnquiries({ search, limit: 8 }, { enabled: search.length >= 2 });

  if (value) {
    return (
      <div className="chip-row">
        <span className="chip">
          {value.enquiryNo} · {value.name}
          <button type="button" aria-label="Change enquiry" onClick={() => onChange(null)}>×</button>
        </span>
      </div>
    );
  }
  return (
    <div>
      <Input id={id} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search enquiry ID, name or phone" autoComplete="off" />
      {search.length >= 2 && (
        <ul className="pick-list" aria-label="Enquiry results">
          {results.isPending && <li className="pick-row muted">Searching…</li>}
          {results.data?.rows.length === 0 && <li className="pick-row muted">No enquiries found</li>}
          {results.data?.rows.map((e) => (
            <li key={e.id}>
              <button type="button" className="pick-row" onClick={() => onChange({ id: e.id, enquiryNo: e.enquiryNo, name: e.name, branchId: e.branchId, stage: e.stage, isArchived: e.isArchived })}>
                <strong>{e.enquiryNo}</strong> {e.name} <span className="muted">{e.stage?.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Escape a user-typed filter before it becomes a RegExp (unit names contain dots, parens and dashes). */
function escapeForMatch(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pick several units to show on a site visit.
 *
 * With an `enquiryId` or a `clientId` the list is the units ALREADY LINKED to that party — resolved by
 * the server from the one relationship model (interests, bookings and visits merged, one row per unit,
 * `via` listing every enquiry the link runs through). That is the point of the change: offering every
 * unit in the branch made the operator hunt through Sold and Booked stock that has nothing to do with
 * this person. When nothing is linked there is a clear empty state with the action that actually fixes
 * it (link a unit through the existing workflow) — never a silent fallback to the whole branch.
 *
 * With neither, the modal is standalone and falls back to the previous behaviour: search the caller's
 * units within one branch, which is the only sensible rule when there is no party to relate them to.
 *
 * `value` is `[{ id, unitCode, name? }]`. The server revalidates the choice when the visit is saved.
 */
export function UnitPicker({ enquiryId, clientId, branchId, value, onChange, onLinkUnit, id = 'sv-units' }) {
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term.trim(), 250);
  // Exactly one of these is live at a time. A client is the WIDER context and wins when both are given:
  // opened from a client page the visit is still for one enquiry, but the operator is working with the
  // person, so the whole (deduplicated) set of their linked units is the useful list.
  const linkedEnquiry = useEnquiryLinkedUnits(clientId ? null : enquiryId);
  const linkedClient = useClientLinkedUnits(clientId);
  const linked = clientId ? linkedClient : linkedEnquiry;
  const hasParty = Boolean(enquiryId || clientId);

  // Without a party: search the caller's units in one branch, server-side (unchanged behaviour).
  const branchSearch = useUnits({ search: search || undefined, branchId, limit: 8 }, { enabled: !hasParty && Boolean(branchId) });

  const chosen = new Set(value.map((u) => u.id));
  const toggle = (u) => onChange(chosen.has(u.id) ? value.filter((x) => x.id !== u.id) : [...value, { id: u.id, unitCode: u.unitCode, name: u.name }]);

  // With a party the set is already small and server-resolved, so the search box narrows it here
  // rather than firing another query. `null` (no permission) and `[]` (nothing linked) stay distinct.
  const linkedRows = linked.data?.units;
  const termRx = term.trim() ? new RegExp(escapeForMatch(term.trim()), 'i') : null;
  const visible = (linkedRows ?? []).filter((u) => !termRx || termRx.test(u.unitCode) || termRx.test(u.name ?? ''));
  const listLabel = clientId ? "This client's linked units" : 'Linked units';

  return (
    <div>
      <Input
        id={id}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={hasParty ? 'Filter the linked units' : 'Search units by ID, name or address'}
        autoComplete="off"
        disabled={!hasParty && !branchId}
      />
      {value.length > 0 && (
        <div className="chip-row" aria-label="Selected units">
          {value.map((u) => (
            <span key={u.id} className="chip">
              {u.unitCode}{u.name ? ` · ${u.name}` : ''}
              <button type="button" aria-label={`Remove ${u.unitCode}`} onClick={() => toggle(u)}>×</button>
            </span>
          ))}
        </div>
      )}

      {hasParty ? (
        linkedRows === null && !linked.isPending ? (
          <p className="pick-row muted" role="note">You don't have permission to view units.</p>
        ) : (
          <>
            <ul className="pick-list" aria-label={listLabel}>
              {linked.isPending && <li className="pick-row muted">Loading…</li>}
              {linked.isError && <li className="pick-row muted" role="alert">{linked.error.message}</li>}
              {visible.map((u) => (
                <li key={u.id}>
                  <label className="pick-row">
                    <input type="checkbox" checked={chosen.has(u.id)} onChange={() => toggle(u)} />
                    <span>
                      <strong>{u.unitCode}</strong> {u.name}
                      {/* Two different facts, shown as two different badges: what the PARTY has with the
                          unit, and where the unit itself stands in inventory. */}
                      <span className="unit-picker-badges">
                        <StatePill state={u.state} />
                        {u.statusLabel && <StatusPill statusKey={u.statusKey} label={u.statusLabel} color={u.statusColor} />}
                      </span>
                      {u.via?.length > 1 && <span className="muted unit-picker-via">via {u.via.map((v) => v.enquiryNo).join(', ')}</span>}
                    </span>
                  </label>
                </li>
              ))}
              {!linked.isPending && !linked.isError && visible.length === 0 && termRx && (linkedRows ?? []).length > 0 && (
                <li className="pick-row muted">No linked unit matches “{term.trim()}”</li>
              )}
            </ul>
            {!linked.isPending && !linked.isError && (linkedRows ?? []).length === 0 && (
              <div className="unit-picker-empty" role="note">
                <p className="muted">
                  {clientId
                    ? 'No units are linked to this client yet.'
                    : 'No units are linked to this enquiry yet.'}{' '}
                  A visit shows the properties the person is actually considering — link one first.
                </p>
                {onLinkUnit && <Button variant="secondary" onClick={onLinkUnit}>Add a unit</Button>}
              </div>
            )}
          </>
        )
      ) : branchId ? (
        <ul className="pick-list" aria-label="Unit results">
          {branchSearch.isPending && <li className="pick-row muted">Loading…</li>}
          {branchSearch.data?.rows.length === 0 && <li className="pick-row muted">No units found</li>}
          {branchSearch.data?.rows.map((u) => (
            <li key={u.id}>
              <label className="pick-row">
                <input type="checkbox" checked={chosen.has(u.id)} onChange={() => toggle(u)} />
                <strong>{u.unitCode}</strong> {u.name} {u.status && <span className="muted">{u.status.label}</span>}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

