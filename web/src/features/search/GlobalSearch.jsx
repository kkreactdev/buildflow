import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGlobalSearch } from '../../api/search';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { usePermissions } from '../../hooks/usePermissions';
import { SearchIcon } from '../../components/ui/icons';
import './search.css';

const MIN = 2;

/** Where each result type opens, and the permission that makes its type searchable (the server decides again). */
const TYPES = [
  { type: 'client', label: 'Clients', permission: 'clients.view', path: (id) => `/clients/${id}` },
  { type: 'enquiry', label: 'Enquiries', permission: 'enquiries.view', path: (id) => `/enquiries/${id}` },
  { type: 'unit', label: 'Units', permission: 'units.view', path: (id) => `/units/${id}` },
  { type: 'booking', label: 'Bookings', permission: 'bookings.view', path: (id) => `/bookings/${id}` },
  { type: 'referral', label: 'Referrals', permission: 'referrals.view', path: (id) => `/referrals/${id}` },
  { type: 'sitevisit', label: 'Site visits', permission: 'sitevisits.view', path: (id) => `/site-visits/${id}` },
  { type: 'document', label: 'Documents', permission: 'documents.view', path: (id) => `/documents/${id}` },
];

/**
 * One search box for the whole app. It only ever calls the search API (which authorizes and scopes each record type on its own),
 * shows what comes back, and navigates to the record's own page, which checks access again. Documents show metadata only.
 */
export function GlobalSearch() {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const listId = useId();
  const box = useRef(null);
  const [text, setText] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const available = useMemo(() => TYPES.filter((t) => can(t.permission)), [can]);
  const q = useDebouncedValue(text.trim(), 300);
  const ready = open && q.length >= MIN && available.length > 0;
  const query = useGlobalSearch({ q, types: type || undefined, limit: 5 }, ready);

  const items = useMemo(() => (ready && query.data ? query.data.results.flatMap((g) => g.items.map((i) => ({ ...i, groupLabel: g.label }))) : []), [ready, query.data]);

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  if (available.length === 0) return null;

  const go = (item) => {
    const target = TYPES.find((t) => t.type === item.type);
    setOpen(false);
    setText('');
    if (target) navigate(target.path(item.id));
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); go(items[active]); }
  };

  const tooShort = text.trim().length < MIN;
  let index = -1;
  return (
    <div className="gsearch" ref={box}>
      <label className="gsearch-box">
        <SearchIcon size={15} />
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label="Search records"
          placeholder="Search clients, enquiries, units…"
          value={text}
          maxLength={64}
          autoComplete="off"
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {open && (
        <div className="gsearch-panel" id={listId} role="listbox" aria-label="Search results">
          <div className="gsearch-types" role="group" aria-label="Record type">
            <button type="button" className={type === '' ? 'is-active' : ''} onClick={() => { setType(''); setActive(-1); }}>All</button>
            {available.map((t) => <button key={t.type} type="button" className={type === t.type ? 'is-active' : ''} onClick={() => { setType(t.type); setActive(-1); }}>{t.label}</button>)}
          </div>
          {tooShort && <p className="gsearch-note">Type at least {MIN} characters.</p>}
          {!tooShort && (query.isPending || q !== text.trim()) && <p className="gsearch-note" role="status">Searching…</p>}
          {!tooShort && query.isError && <p className="gsearch-note" role="alert">{query.error?.status === 403 ? 'You cannot search that record type.' : 'Search failed. Try again.'}</p>}
          {!tooShort && query.data && q === text.trim() && items.length === 0 && <p className="gsearch-note">No matches for “{q}”.</p>}
          {!tooShort && query.data && q === text.trim() && query.data.results.map((g) => (
            <div key={g.type} role="group" aria-label={g.label}>
              <h4 className="gsearch-group">{g.label}{g.hasMore && <span> · showing first {g.items.length}</span>}</h4>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                return (
                  <div key={`${item.type}-${item.id}`} role="option" aria-selected={i === active} tabIndex={-1} className={`gsearch-item ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(item)}>
                    <strong>{item.title}</strong>
                    <span>{item.subtitle}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
