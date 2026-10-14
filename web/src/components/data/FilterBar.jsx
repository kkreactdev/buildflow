import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { SearchInput } from './SearchInput';
import './data.css';

/** Layout wrapper for a list page's search + filters + reset. */
export function FilterBar({ search, onSearch, searchPlaceholder, children, onReset, canReset, actions }) {
  return (
    <div className="filter-bar">
      {onSearch && <SearchInput value={search} onSearch={onSearch} placeholder={searchPlaceholder} />}
      <div className="filter-bar-filters">{children}</div>
      {canReset && onReset && (
        <Button variant="ghost" onClick={onReset}>
          Clear
        </Button>
      )}
      {actions && <div className="filter-bar-actions">{actions}</div>}
    </div>
  );
}

/**
 * `options` come from the server (masters) — never hard-code them in a page.
 * `[{ value, label }]`.
 */
export function FilterSelect({ label, value, onChange, options = [], allLabel = 'All', loading = false }) {
  return (
    <Select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={loading}>
      <option value="">{loading ? 'Loading…' : `${allLabel} ${label}`}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
