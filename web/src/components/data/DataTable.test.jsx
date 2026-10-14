import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';

const columns = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'city', header: 'City' },
];
const rows = [
  { id: 1, name: 'Raj', city: 'Chennai' },
  { id: 2, name: 'Asha', city: 'Madurai' },
];

describe('DataTable', () => {
  it('renders rows and column headers', () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByText('Raj')).toBeTruthy();
    expect(screen.getByText('Madurai')).toBeTruthy();
  });

  it('reports sort intent and reflects aria-sort', () => {
    const onSortChange = vi.fn();
    render(<DataTable columns={columns} rows={rows} sort="-name" onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSortChange).toHaveBeenCalledWith('name');
    expect(screen.getByRole('columnheader', { name: /name/i }).getAttribute('aria-sort')).toBe('descending');
  });

  it('shows skeleton rows while loading with no data', () => {
    const { container } = render(<DataTable columns={columns} rows={[]} loading />);
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });

  it('shows the empty state when there are no rows', () => {
    render(<DataTable columns={columns} rows={[]} empty={{ title: 'No enquiries' }} />);
    expect(screen.getByText('No enquiries')).toBeTruthy();
  });

  it('shows an error with retry', () => {
    const onRetry = vi.fn();
    render(<DataTable columns={columns} rows={[]} error={new Error('boom')} onRetry={onRetry} />);
    expect(screen.getByText('boom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('paginates from server meta', () => {
    const onPageChange = vi.fn();
    render(<DataTable columns={columns} rows={rows} meta={{ page: 2, limit: 2, total: 5 }} onPageChange={onPageChange} />);
    expect(screen.getByText('3–4 of 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('row click and row actions are separate', () => {
    const onRowClick = vi.fn();
    const action = vi.fn();
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} rowActions={() => <button onClick={action}>act</button>} />);
    fireEvent.click(screen.getAllByText('act')[0]);
    expect(action).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Raj'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('puts the table in a focusable, labelled horizontal scroll region and keeps pagination outside it', () => {
    const { container } = render(<DataTable columns={columns} rows={rows} meta={{ page: 1, limit: 1, total: 2 }} onPageChange={() => {}} />);
    const region = screen.getByRole('region', { name: /scroll sideways/i });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.classList.contains('data-table-scroll')).toBe(true);
    expect(region.querySelector('table')).toBe(container.querySelector('table'));
    expect(region.contains(container.querySelector('.pagination'))).toBe(false); // paging is not scrolled away with the columns
  });

  it('wraps only the columns that opt in, and keeps every column (none are hidden to fit)', () => {
    const cols = [{ key: 'name', header: 'Name' }, { key: 'notes', header: 'Notes', wrap: true }, { key: 'city', header: 'City', minWidth: 140 }];
    const { container } = render(<DataTable columns={cols} rows={[{ id: 1, name: 'Raj', notes: 'A long free-text note', city: 'Chennai' }]} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(container.querySelectorAll('td.is-wrap')).toHaveLength(1);
    expect(container.querySelector('th.is-wrap').style.minWidth).toBe('220px');
    expect(container.querySelectorAll('th')[2].style.minWidth).toBe('140px');
  });
});
