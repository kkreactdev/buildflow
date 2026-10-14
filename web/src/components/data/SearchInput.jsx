import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { SearchIcon } from '../ui/icons';
import './data.css';

/**
 * Debounced search box. Calls `onSearch` after the user pauses typing. If
 * `value` changes from outside (e.g. "clear filters") the text follows it.
 */
export function SearchInput({ value = '', onSearch, placeholder = 'Search…', delay = 350 }) {
  const [text, setText] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setText(value);
  }

  const debounced = useDebouncedValue(text, delay);
  const latest = useRef({ value, onSearch });
  useEffect(() => {
    latest.current = { value, onSearch };
  });
  useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed !== latest.current.value) latest.current.onSearch(trimmed);
  }, [debounced]);

  return (
    <label className="search-input">
      <SearchIcon size={16} />
      <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}
