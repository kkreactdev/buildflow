import { useState } from 'react';

const pad = (n) => String(n).padStart(2, '0');

/** `Date` → the `YYYY-MM-DDTHH:mm` string a datetime-local input expects (browser-local time). */
export function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatWhen(iso) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

/** A stable "now" for a datetime input's `min`, fixed when the dialog opens. */
export function useMinWhen() {
  const [min] = useState(() => toLocalInput(new Date()));
  return min;
}
