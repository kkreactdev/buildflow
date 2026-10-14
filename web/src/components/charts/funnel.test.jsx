import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FunnelChart } from './FunnelChart';

const show = (stages) => render(<MemoryRouter><FunnelChart ariaLabel="Funnel" stages={stages} /></MemoryRouter>);

describe('FunnelChart', () => {
  it('lists every stage in the given order with its exact count', () => {
    show([{ key: 'a', label: 'New', value: 90 }, { key: 'b', label: 'Site visit scheduled', value: 12 }, { key: 'c', label: 'Booked', value: 0 }]);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.funnel-name').textContent)).toEqual(['New', 'Site visit scheduled', 'Booked']);
    expect(rows.map((r) => r.querySelector('.funnel-count').textContent)).toEqual(['90', '12', '0']);
    expect(screen.getByTitle('Booked: 0 enquiries')).toBeTruthy();
  });

  it('sizes bands by their own count, so a stage larger than the one above is drawn wider (workflows can move back)', () => {
    const { container } = show([{ key: 'a', label: 'A', value: 10 }, { key: 'b', label: 'B', value: 40 }]);
    const [a, b] = [...container.querySelectorAll('.funnel-band')].map((e) => e.style.clipPath);
    const topWidth = (clip) => { const m = /polygon\(([\d.]+)% 0, ([\d.]+)% 0/.exec(clip); return +m[2] - +m[1]; };
    expect(topWidth(b)).toBeGreaterThan(topWidth(a));
    expect(topWidth(b)).toBeCloseTo(100, 0);
  });

  it('keeps empty stages visible (minimum width) and never divides by zero when everything is zero', () => {
    const { container } = show([{ key: 'a', label: 'A', value: 0 }, { key: 'b', label: 'B', value: 0 }]);
    expect(container.querySelectorAll('.funnel-band')).toHaveLength(2);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('links a stage only when it has a destination', () => {
    show([{ key: 'a', label: 'New', value: 3, to: '/enquiries?stage=NEW' }, { key: 'b', label: 'Booked', value: 1 }]);
    expect(screen.getByRole('link', { name: /New/ }).getAttribute('href')).toBe('/enquiries?stage=NEW');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
