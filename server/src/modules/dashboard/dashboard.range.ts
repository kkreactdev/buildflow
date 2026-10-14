import { z } from 'zod';
import { getEnv } from '../../config/env';
import { addLocalDays, daysBetween, isLocalDate, localDateStart, localDateString } from '../../lib/time';
import { AppError } from '../../lib/appError';
import { objectIdSchema } from '../../lib/ids';

export const MAX_RANGE_DAYS = 366;
const localDate = z.string().refine(isLocalDate, 'Use a real date written YYYY-MM-DD');

/**
 * The dashboard's filters. `from` / `to` are CALENDAR DAYS in the business time zone (both inclusive), so "today" means the
 * branch's today, not the server's or the browser's. Branch and salesperson filters can only NARROW what the scope allows.
 */
export const dashboardQuery = z
  .object({
    from: localDate.optional(),
    to: localDate.optional(),
    branchId: objectIdSchema.optional(),
    assignedTo: objectIdSchema.optional(),
    sourceId: objectIdSchema.optional(),
    propertyTypeId: objectIdSchema.optional(),
    buildingTypeId: objectIdSchema.optional(),
  })
  .strict();
export type DashboardQuery = z.infer<typeof dashboardQuery>;

export interface Range {
  /** Inclusive first and last local day, as given or defaulted. */
  from: string;
  to: string;
  days: number;
  /** [start, end): end is the start of the day AFTER `to`. */
  start: Date;
  end: Date;
  /** The same number of days immediately before `from`. */
  prevFrom: string;
  prevTo: string;
  prevStart: Date;
  prevEnd: Date;
  timeZone: string;
}

/** Default: the last 30 days ending today. Rejects reversed, future-only nonsense and ranges over a year. */
export function resolveRange(q: Pick<DashboardQuery, 'from' | 'to'>, now = new Date()): Range {
  const timeZone = getEnv().APP_TIMEZONE;
  const today = localDateString(now, timeZone);
  const to = q.to ?? today;
  const from = q.from ?? addLocalDays(to, -29);
  const days = daysBetween(from, to) + 1;
  if (days < 1) throw AppError.validation('The start date must not be after the end date', [{ path: 'from', message: 'Must not be after the end date' }]);
  if (days > MAX_RANGE_DAYS) throw AppError.validation(`Choose a range of at most ${MAX_RANGE_DAYS} days`, [{ path: 'from', message: `At most ${MAX_RANGE_DAYS} days` }]);
  const prevTo = addLocalDays(from, -1);
  const prevFrom = addLocalDays(prevTo, -(days - 1));
  return {
    from, to, days, timeZone,
    start: localDateStart(from, timeZone), end: localDateStart(addLocalDays(to, 1), timeZone),
    prevFrom, prevTo, prevStart: localDateStart(prevFrom, timeZone), prevEnd: localDateStart(from, timeZone),
  };
}
