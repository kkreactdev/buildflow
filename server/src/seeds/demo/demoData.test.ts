import { describe, expect, it } from 'vitest';
import { BRANCHES, CLIENTS, DEMO_EMAIL_DOMAIN, EMPLOYEES, ENQUIRIES, EXTERNAL_REFERRERS, TEMPLATES, UNITS, salesOf } from './demoData';
import { analyzeTemplate } from '../../lib/templateVariables';

describe('demo dataset definition', () => {
  it('uses unique, clearly fictional identities (phones, emails, unit names, branch codes)', () => {
    const phones = [...ENQUIRIES.map((e) => e.phone), ...CLIENTS.map((c) => c.phone), ...EXTERNAL_REFERRERS.map((r) => r.phone), ...EMPLOYEES.map((e) => e.phone)];
    expect(new Set(phones).size).toBe(phones.length);
    expect(phones.every((p) => /^90000\d{5}$/.test(p))).toBe(true);
    expect(new Set(UNITS.map((u) => u.name)).size).toBe(UNITS.length);
    expect(new Set(BRANCHES.map((b) => b.code)).size).toBe(BRANCHES.length);
    expect(BRANCHES.every((b) => b.code.startsWith('DEMO-'))).toBe(true);
    expect(CLIENTS.every((c) => c.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`))).toBe(true);
  });

  it('covers every branch with managers and several salespeople, within the planned volumes', () => {
    expect(salesOf(0).length).toBeGreaterThanOrEqual(3);
    expect(salesOf(1).length).toBeGreaterThanOrEqual(3);
    expect(EMPLOYEES.filter((e) => e.role === 'SALES_EXECUTIVE').length).toBeGreaterThanOrEqual(4);
    expect(ENQUIRIES.length).toBeGreaterThanOrEqual(25);
    expect(ENQUIRIES.length).toBeLessThanOrEqual(40);
    expect(CLIENTS.length).toBeGreaterThanOrEqual(12);
    expect(UNITS.length).toBeGreaterThanOrEqual(12);
  });

  it('plans enquiries across the whole workflow and never more bookings than there are units to book', () => {
    const plans = new Set(ENQUIRIES.map((e) => e.plan));
    for (const p of ['NEW', 'CONTACTED', 'INTERESTED', 'VISIT_UPCOMING', 'VISIT_OVERDUE', 'VISIT_DONE', 'NEGOTIATION', 'BOOKED', 'LOST']) expect(plans.has(p as never)).toBe(true);
    for (const branch of [0, 1] as const) {
      const wanted = ENQUIRIES.filter((e) => e.branch === branch && e.plan === 'BOOKED').length;
      expect(UNITS.filter((u) => u.branch === branch && u.status === 'BOOKED').length).toBeGreaterThanOrEqual(wanted);
    }
    expect(new Set(UNITS.map((u) => u.status))).toEqual(new Set(['AVAILABLE', 'BOOKED', 'SOLD', 'HOLD']));
  });

  it('only uses supported placeholders in the WhatsApp templates', () => {
    for (const t of TEMPLATES) expect(analyzeTemplate(t.body).issues, t.name).toEqual([]);
  });
});
