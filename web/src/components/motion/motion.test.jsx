import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountUp } from './CountUp';
import { Reveal } from './Reveal';

afterEach(() => vi.unstubAllGlobals());

function fakeObserver() {
  const observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() {}
  });
  return { show: () => act(() => observers.forEach((o) => o.cb([{ isIntersecting: true }]))) };
}

describe('Reveal', () => {
  it('is visible at once where IntersectionObserver is unavailable', () => {
    render(<Reveal>hello</Reveal>);
    expect(screen.getByText('hello').className).toContain('is-in');
  });

  it('stays hidden until scrolled into view, then reveals once', () => {
    const io = fakeObserver();
    render(<Reveal index={2}>later</Reveal>);
    expect(screen.getByText('later').className).not.toContain('is-in');
    expect(screen.getByText('later').style.getPropertyValue('--i')).toBe('2');
    io.show();
    expect(screen.getByText('later').className).toContain('is-in');
  });

  it('shows everything immediately when the user prefers reduced motion', () => {
    fakeObserver();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Reveal>calm</Reveal>);
    expect(screen.getByText('calm').className).toContain('is-in');
  });
});

describe('CountUp', () => {
  it('renders the exact value (Indian grouping) when motion is unavailable', () => {
    render(<CountUp value={1234567} />);
    expect(screen.getByLabelText('12,34,567').textContent).toBe('12,34,567');
  });

  it('never exposes anything but the real value to assistive technology, and ends on it', async () => {
    const io = fakeObserver();
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    render(<CountUp value={42} duration={200} />);
    expect(screen.getByLabelText('42')).toBeTruthy();
    expect(screen.getByLabelText('42').textContent).toBe('0'); // starts from zero only until first seen
    io.show();
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(screen.getByLabelText('42').textContent).toBe('42');
    vi.useRealTimers();
  });

  it('shows the value at once with reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    fakeObserver();
    render(<CountUp value={9} />);
    expect(screen.getByLabelText('9').textContent).toBe('9');
  });
});
