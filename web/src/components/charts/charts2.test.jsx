import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColumnChart } from './ColumnChart';
import { DonutPanel } from './DonutPanel';
import { HBarChart } from './HBarChart';

describe('HBarChart', () => {
  const series = [{ key: 'a', label: 'In stage now', color: '#0d9488' }, { key: 'b', label: 'Entered', color: '#7c3aed' }];
  const rows = [{ key: 'n', label: 'New', values: { a: 5, b: 10 } }, { key: 'c', label: 'Contacted', values: { a: 0, b: 2 } }];

  it('draws widths relative to the largest value and states every exact value', () => {
    const { container } = render(<HBarChart ariaLabel="Stages" series={series} rows={rows} />);
    const fills = [...container.querySelectorAll('.hbar-fill')].map((f) => f.style.width);
    expect(fills).toEqual(['50%', '100%', '0%', '20%']);
    expect(screen.getByTitle('New · Entered: 10')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Stages' })).toBeTruthy();
  });

  it('shows a legend only for more than one series and copes with all-zero data', () => {
    const { container, rerender } = render(<HBarChart ariaLabel="x" series={series.slice(0, 1)} rows={[{ key: 'z', label: 'Zero', values: { a: 0 } }]} />);
    expect(container.querySelector('.chart-legend')).toBeNull();
    expect(container.querySelector('.hbar-fill').style.width).toBe('0%');
    rerender(<HBarChart ariaLabel="x" series={series} rows={rows} />);
    expect(container.querySelector('.chart-legend')).toBeTruthy();
  });
});

describe('ColumnChart', () => {
  it('scales columns to the largest value and labels each', () => {
    const { container } = render(<ColumnChart ariaLabel="Bookings" items={[{ key: 'a', label: 'Active', value: 4, color: '#0d9488' }, { key: 'b', label: 'Released', value: 1, color: '#dc2626' }]} />);
    expect([...container.querySelectorAll('.col-bar')].map((b) => b.style.height)).toEqual(['100%', '25%']);
    expect(screen.getByTitle('Released: 1')).toBeTruthy();
  });
});

describe('DonutPanel', () => {
  it('lists every slice with its exact count and rounded share', () => {
    render(<DonutPanel centerLabel="Units" data={[{ name: 'Available', value: 6, color: '#16a34a' }, { name: 'Sold', value: 2, color: '#7c3aed' }]} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Available')).toBeTruthy();
    expect(within(rows[0]).getByText('6')).toBeTruthy();
    expect(within(rows[0]).getByText('75%')).toBeTruthy();
    expect(within(rows[1]).getByText('25%')).toBeTruthy();
  });

  it('shows an empty ring rather than inventing a share when there is no data', () => {
    render(<DonutPanel centerLabel="Units" data={[{ name: 'None', value: 0, color: '#999' }]} />);
    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
  });
});
