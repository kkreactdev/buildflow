/**
 * Calendar-day boundaries in a business time zone (APP_TIMEZONE), without a date library.
 * "Today's follow-ups" must mean today for the BRANCH, not for the server or the browser.
 */
function offsetMinutes(at: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  if (!m) return 0; // plain "GMT" = UTC
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** The instant of 00:00 on the given local calendar date in `timeZone`. */
function startOfLocalDay(y: number, m: number, d: number, timeZone: string): Date {
  const utcMidnight = Date.UTC(y, m - 1, d);
  let t = utcMidnight - offsetMinutes(new Date(utcMidnight), timeZone) * 60_000;
  t = utcMidnight - offsetMinutes(new Date(t), timeZone) * 60_000; // second pass settles DST transitions
  return new Date(t);
}

/** `[start, end)` of the local day containing `now`. */
export function zonedDayRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number) as [number, number, number];
  return { start: startOfLocalDay(y, m, d, timeZone), end: startOfLocalDay(y, m, d + 1, timeZone) };
}

/** Human-readable local date and time, e.g. "08 Oct 2026, 03:30 pm". */
export function formatLocal(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(at);
}

/**
 * The instant of `hour`:00 (local) on the calendar day AFTER the one containing `now`, in `timeZone`.
 * "Tomorrow" means the next calendar day of the business, not 24 hours later.
 */
export function nextLocalDayAt(now: Date, timeZone: string, hour: number): Date {
  const tomorrow = zonedDayRange(now, timeZone).end; // 00:00 of the next local day
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(tomorrow.getTime() + 60_000)).split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d, hour);
  let t = utc - offsetMinutes(new Date(utc), timeZone) * 60_000;
  t = utc - offsetMinutes(new Date(t), timeZone) * 60_000;
  return new Date(t);
}

/** Today's date in the business time zone as `YYYY-MM-DD`. */
export function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** True for a real calendar date written `YYYY-MM-DD` (2026-02-30 is not). */
export function isLocalDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** The instant of 00:00 on the local calendar date `YYYY-MM-DD` in `timeZone`. */
export function localDateStart(date: string, timeZone: string): Date {
  const m = DATE_RE.exec(date)!;
  return startOfLocalDay(Number(m[1]), Number(m[2]), Number(m[3]), timeZone);
}

/** `date` moved by whole calendar days (calendar arithmetic, so daylight-saving days are not an issue). */
export function addLocalDays(date: string, days: number): string {
  const m = DATE_RE.exec(date)!;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
