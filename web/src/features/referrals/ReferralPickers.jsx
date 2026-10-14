import { useState } from 'react';
import { useUsers } from '../../api/admin';
import { useClients } from '../../api/clients';
import { useReferrals } from '../../api/referrals';
import { Input } from '../../components/ui/Input';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import '../sitevisits/sitevisits.css';

function Chosen({ label, onClear, clearLabel }) {
  return (
    <div className="chip-row">
      <span className="chip">
        {label}
        <button type="button" aria-label={clearLabel} onClick={onClear}>×</button>
      </span>
    </div>
  );
}

/** Search-and-pick an existing client. The server searches, and only returns clients the user may see. */
export function ClientPicker({ value, onChange }) {
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const results = useClients({ search, limit: 8 });
  if (value) return <Chosen label={`${value.clientNo} · ${value.name}`} clearLabel="Change client" onClear={() => onChange(null)} />;
  return (
    <div>
      <Input id="rf-client" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search client ID, name or phone" autoComplete="off" />
      {search.length >= 2 && (
        <ul className="pick-list" aria-label="Client results">
          {results.isPending && <li className="pick-row muted">Searching…</li>}
          {results.data?.rows.length === 0 && <li className="pick-row muted">No clients found</li>}
          {results.data?.rows.map((c) => (
            <li key={c.id}>
              <button type="button" className="pick-row" onClick={() => onChange({ id: c.id, clientNo: c.clientNo, name: c.name })}>
                <strong>{c.clientNo}</strong> {c.name} <span className="muted">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search-and-pick an existing employee (needs permission to list users). */
export function EmployeePicker({ value, onChange }) {
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const results = useUsers({ search, isActive: 'true', limit: 8 });
  if (value) return <Chosen label={value.name} clearLabel="Change employee" onClear={() => onChange(null)} />;
  return (
    <div>
      <Input id="rf-employee" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search employee name or email" autoComplete="off" />
      {search.length >= 2 && (
        <ul className="pick-list" aria-label="Employee results">
          {results.isPending && <li className="pick-row muted">Searching…</li>}
          {results.data?.rows.length === 0 && <li className="pick-row muted">No employees found</li>}
          {results.data?.rows.map((u) => (
            <li key={u.id}>
              <button type="button" className="pick-row" onClick={() => onChange({ id: u.id, name: u.name, branchIds: u.branchIds })}>
                <strong>{u.name}</strong> <span className="muted">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search-and-pick an existing referral (to link it to an enquiry). */
export function ReferralPicker({ value, onChange }) {
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const results = useReferrals({ search, limit: 8 }, { enabled: search.length >= 2 });
  if (value) return <Chosen label={`${value.referralNo} · ${value.name}`} clearLabel="Change referral" onClear={() => onChange(null)} />;
  return (
    <div>
      <Input id="rf-pick" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search referral ID, name or phone" autoComplete="off" />
      {search.length >= 2 && (
        <ul className="pick-list" aria-label="Referral results">
          {results.isPending && <li className="pick-row muted">Searching…</li>}
          {results.data?.rows.length === 0 && <li className="pick-row muted">No referrals found</li>}
          {results.data?.rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="pick-row" onClick={() => onChange({ id: r.id, referralNo: r.referralNo, name: r.name })}>
                <strong>{r.referralNo}</strong> {r.name} <span className="muted">{r.type?.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
