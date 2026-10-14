import { describe, expect, it } from 'vitest';
import { addLocalDays, daysBetween, formatLocal, isLocalDate, localDateStart, localDateString, nextLocalDayAt, zonedDayRange } from './time';

describe('zonedDayRange', () => {
  it('uses the business time zone, not the server\'s', () => {
    // 20:00 UTC on 8 Oct is already 01:30 on 9 Oct in India
    const r = zonedDayRange(new Date('2026-10-08T20:00:00Z'), 'Asia/Kolkata');
    expect(r.start.toISOString()).toBe('2026-10-08T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-09T18:30:00.000Z');
    const utc = zonedDayRange(new Date('2026-10-08T20:00:00Z'), 'UTC');
    expect(utc.start.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
  it('the day includes its first instant and excludes the next midnight', () => {
    const r = zonedDayRange(new Date('2026-10-08T18:30:00Z'), 'Asia/Kolkata'); // exactly 00:00 on 9 Oct IST
    expect(r.start.toISOString()).toBe('2026-10-08T18:30:00.000Z');
    expect(zonedDayRange(new Date('2026-10-08T18:29:59Z'), 'Asia/Kolkata').end.toISOString()).toBe('2026-10-08T18:30:00.000Z');
  });
  it('handles daylight-saving days (23- and 25-hour days)', () => {
    const spring = zonedDayRange(new Date('2026-03-08T12:00:00Z'), 'America/New_York');
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
    const autumn = zonedDayRange(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000).toBe(25);
  });
  it('formats local time readably', () => {
    expect(formatLocal(new Date('2026-10-08T10:00:00Z'), 'Asia/Kolkata')).toMatch(/08 Oct 2026.*03:30/i);
  });
});

describe('nextLocalDayAt', () => {
  it('is the next CALENDAR day of the business at the given hour', () => {
    // 20:00 UTC on 8 Oct is 01:30 on 9 Oct in India, so "tomorrow" is 10 Oct
    expect(nextLocalDayAt(new Date('2026-10-08T20:00:00Z'), 'Asia/Kolkata', 10).toISOString()).toBe('2026-10-10T04:30:00.000Z');
    expect(nextLocalDayAt(new Date('2026-10-08T05:00:00Z'), 'Asia/Kolkata', 10).toISOString()).toBe('2026-10-09T04:30:00.000Z');
    expect(nextLocalDayAt(new Date('2026-10-08T23:59:00Z'), 'UTC', 9).toISOString()).toBe('2026-10-09T09:00:00.000Z');
  });
  it('keeps the local hour across a daylight-saving change', () => {
    // 7 Mar 2026 evening in New York; 8 Mar is the spring-forward day (EST -> EDT after 02:00)
    expect(nextLocalDayAt(new Date('2026-03-07T20:00:00Z'), 'America/New_York', 10).toISOString()).toBe('2026-03-08T14:00:00.000Z'); // 10:00 EDT
  });
});

describe('local calendar dates', () => {
  it('reads the business-zone date and builds day boundaries from it', () => {
    expect(localDateString(new Date('2026-10-08T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-09'); // already tomorrow in India
    expect(localDateStart('2026-10-09', 'Asia/Kolkata').toISOString()).toBe('2026-10-08T18:30:00.000Z');
    expect(localDateStart('2026-10-09', 'UTC').toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });
  it('validates and moves calendar dates', () => {
    expect(['2026-02-28', '2024-02-29'].every(isLocalDate)).toBe(true);
    expect(['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', ''].some(isLocalDate)).toBe(false);
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });
  it('a day range across a daylight-saving change still spans calendar days', () => {
    const start = localDateStart('2026-03-08', 'America/New_York');
    const end = localDateStart('2026-03-09', 'America/New_York');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });
});
