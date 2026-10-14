const WILDCARD = '*';

/**
 * Pure permission check against permission KEYS. Fail-closed: no key, or no
 * granted set, is false. UX only — the server enforces every permission itself.
 */
export function hasPermission(granted, key) {
  if (!key || !granted) return false;
  const has = typeof granted.has === 'function' ? (k) => granted.has(k) : (k) => granted.includes(k);
  return has(WILDCARD) || has(key);
}
