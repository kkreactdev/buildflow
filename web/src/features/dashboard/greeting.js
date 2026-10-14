/** "Good morning" etc. from an hour (0-23) in the business time zone. */
export function greeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The current hour in `timeZone` (falls back to the browser's). */
export function hourIn(timeZone, now = new Date()) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(now)) % 24;
  } catch {
    return now.getHours();
  }
}

/** `YYYY-MM-DD` for a date in `timeZone` (the dashboard speaks in business-zone calendar days). */
export function dayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
