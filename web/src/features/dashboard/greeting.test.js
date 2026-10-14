import { describe, expect, it } from 'vitest';
import { addDays, dayIn, greeting, hourIn } from './greeting';

describe('dashboard date helpers', () => {
  it('greets by hour', () => {
    expect([greeting(5), greeting(12), greeting(16), greeting(17), greeting(23)]).toEqual(['Good morning', 'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening']);
  });
  it('reads the hour and day in the business time zone, not the machine\'s', () => {
    const t = new Date('2026-03-09T20:00:00Z'); // 01:30 on 10 Mar in Asia/Kolkata
    expect(hourIn('Asia/Kolkata', t)).toBe(1);
    expect(dayIn('Asia/Kolkata', t)).toBe('2026-03-10');
    expect(dayIn('America/New_York', t)).toBe('2026-03-09');
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-03-10', -29)).toBe('2026-02-09');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

import { columnsFor } from './layout';

describe('KPI grid columns', () => {
  it('uses every card in a row up to four, six across when wide, and never leaves a ragged last row', () => {
    expect([1, 2, 3, 4].map(columnsFor)).toEqual([1, 2, 3, 4]);
    expect(columnsFor(6)).toBe(6);
    expect(columnsFor(9)).toBe(3);
    expect(columnsFor(8)).toBe(4);
    expect(columnsFor(5)).toBe(5);
  });
});
