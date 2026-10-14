import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchInput } from '../components/data/SearchInput';
import { ActionMenu } from '../components/ui/ActionMenu';
import { ApiError } from '../api/http';
import { rules, validate } from '../lib/validation';
import { useForm } from './useForm';
import { useTableState } from './useTableState';

const routerWrap = (initial = '/') => ({ children }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;

describe('useTableState', () => {
  it('reads defaults and filters from the URL', () => {
    const { result } = renderHook(() => useTableState({ filterKeys: ['status'] }), { wrapper: routerWrap('/?page=3&status=NEW&search=raj') });
    expect(result.current.params).toMatchObject({ page: 3, limit: 25, sort: '-createdAt', search: 'raj', status: 'NEW' });
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('filter/search changes reset to page 1; page change does not', () => {
    const { result } = renderHook(
      () => ({ t: useTableState({ filterKeys: ['status'] }), loc: useLocation() }),
      { wrapper: routerWrap('/?page=4') },
    );
    act(() => result.current.t.setFilter('status', 'NEW'));
    expect(result.current.loc.search).toBe('?status=NEW');
    act(() => result.current.t.setPage(2));
    expect(result.current.t.params.page).toBe(2);
    act(() => result.current.t.setFilter('status', ''));
    expect(result.current.t.params.status).toBeUndefined();
  });

  it('toggles sort direction', () => {
    const { result } = renderHook(() => useTableState({ defaultSort: 'name' }), { wrapper: routerWrap() });
    act(() => result.current.setSort('name'));
    expect(result.current.params.sort).toBe('-name');
    act(() => result.current.setSort('name'));
    expect(result.current.params.sort).toBe('name');
  });

  it('reset clears everything', () => {
    const { result } = renderHook(() => useTableState({ filterKeys: ['status'] }), { wrapper: routerWrap('/?status=NEW&search=x') });
    act(() => result.current.reset());
    expect(result.current.hasActiveFilters).toBe(false);
  });
});

describe('validation + useForm', () => {
  it('validates with first-failing-rule-per-field', () => {
    const errors = validate({ name: ' ', phone: '12' }, { name: [rules.required()], phone: [rules.required(), rules.phone()] });
    expect(errors).toEqual({ name: 'Required', phone: 'Enter a valid phone number' });
    expect(validate({ name: 'A', phone: '9876543210' }, { name: [rules.required()], phone: [rules.phone()] })).toEqual({});
  });

  it('blocks submit on client errors', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useForm({ initialValues: { name: '' }, schema: { name: [rules.required()] }, onSubmit }));
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.errors.name).toBe('Required');
  });

  it('maps server validation errors onto fields and other errors to formError', async () => {
    const serverErr = new ApiError('Validation failed', { status: 400, code: 'VALIDATION_ERROR', details: [{ path: 'name', message: 'Taken' }] });
    const onSubmit = vi.fn().mockRejectedValueOnce(serverErr).mockRejectedValueOnce(new Error('Network down'));
    const { result } = renderHook(() => useForm({ initialValues: { name: 'x' }, onSubmit }));
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(result.current.errors).toEqual({ name: 'Taken' });
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(result.current.formError).toBe('Network down');
    expect(result.current.submitting).toBe(false);
  });

  it('clears a field error when the field changes', async () => {
    const { result } = renderHook(() => useForm({ initialValues: { name: '' }, schema: { name: [rules.required()] }, onSubmit: vi.fn() }));
    await act(async () => {
      await result.current.handleSubmit();
    });
    act(() => result.current.setValue('name', 'a'));
    expect(result.current.errors.name).toBeUndefined();
  });
});

describe('SearchInput', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces, trims, and does not fire for unchanged text', () => {
    const onSearch = vi.fn();
    render(<SearchInput value="" onSearch={onSearch} delay={300} />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: ' ra' } });
    fireEvent.change(input, { target: { value: ' raj ' } });
    act(() => vi.advanceTimersByTime(299));
    expect(onSearch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('raj');
  });

  it('follows external value resets', () => {
    const { rerender } = render(<SearchInput value="abc" onSearch={() => {}} />);
    expect(screen.getByRole('searchbox').value).toBe('abc');
    rerender(<SearchInput value="" onSearch={() => {}} />);
    expect(screen.getByRole('searchbox').value).toBe('');
  });
});

describe('ActionMenu', () => {
  it('hides unavailable actions and renders nothing when none are visible', () => {
    const { container, rerender } = render(<ActionMenu items={[{ label: 'Delete', hidden: true }]} />);
    expect(container.firstChild).toBeNull();
    const onSelect = vi.fn();
    rerender(<ActionMenu items={[{ label: 'Delete', hidden: true }, { label: 'View', onSelect }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.queryByText('Delete')).toBeNull();
    fireEvent.click(screen.getByText('View'));
    expect(onSelect).toHaveBeenCalled();
  });
});
