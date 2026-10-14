import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { statusColor, STATUS_COLORS } from '../../lib/statusTones';
import { StatusPill } from './StatusPill';

describe('shared status colours', () => {
  it('give every well-known state one colour, regardless of the colour stored on its master', () => {
    expect(statusColor('MISSED', '#00aa00')).toBe(STATUS_COLORS.MISSED);
    expect(statusColor('missed')).toBe(STATUS_COLORS.MISSED);
    expect(STATUS_COLORS.MISSED).not.toBe(STATUS_COLORS.COMPLETED);
    expect(statusColor('RELEASED')).not.toBe(statusColor('ACTIVE'));
  });

  it('keep the configured colour for statuses an administrator added', () => {
    expect(statusColor('SHORTLISTED', '#123456')).toBe('#123456');
    expect(statusColor('SHORTLISTED')).toBeUndefined();
  });

  it('render the label from the data and a dot only when there is a colour', () => {
    const { container, rerender } = render(<StatusPill statusKey="MISSED" label="Overdue call" />);
    expect(screen.getByText('Overdue call')).toBeTruthy();
    expect(container.querySelector('.pill-dot')).toBeTruthy();
    rerender(<StatusPill statusKey="CUSTOM" label="Custom" />);
    expect(container.querySelector('.pill-dot')).toBeNull();
  });
});
