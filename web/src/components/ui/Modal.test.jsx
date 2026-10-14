import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDialogScrollLock } from '../../hooks/useDialogBehavior';
import { ActionMenu } from './ActionMenu';
import { Modal } from './Modal';

afterEach(() => resetDialogScrollLock());

/** A page whose card hovers (transform), like the real ones, holding a dialog with a typed-into field. */
function Page({ onRender }) {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  onRender?.();
  return (
    <div className="card card-padded" data-testid="card" style={{ transform: 'translateY(-2px)' }}>
      <button onClick={() => setOpen(true)}>Open</button>
      <button onClick={() => force((n) => n + 1)}>Re-render parent</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Complete visit" footer={<button onClick={() => setOpen(false)}>Cancel</button>}>
        <input aria-label="Feedback" defaultValue="" />
      </Modal>
    </div>
  );
}

describe('Modal lifecycle', () => {
  it('is drawn in <body>, outside any transformed page ancestor (the cause of the flicker)', () => {
    render(<Page />);
    fireEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog', { name: 'Complete visit' });
    expect(screen.getByTestId('card').contains(dialog)).toBe(false);
    expect(dialog.closest('.modal-backdrop').parentElement).toBe(document.body);
  });

  it('stays one stable instance and keeps typed text while the parent re-renders (with a new onClose each time)', () => {
    render(<Page />);
    fireEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog');
    const input = screen.getByLabelText('Feedback');
    fireEvent.change(input, { target: { value: 'Liked the villa' } });
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('Re-render parent'));
    expect(screen.getByRole('dialog')).toBe(dialog); // the same DOM node: never unmounted and rebuilt
    expect(screen.getByLabelText('Feedback')).toBe(input);
    expect(input.value).toBe('Liked the villa');
    expect(document.querySelectorAll('.modal-backdrop')).toHaveLength(1);
  });

  it('locks page scroll once per opening and releases it when closed, however often the parent re-renders', () => {
    const style = vi.spyOn(document.body.style, 'overflow', 'set');
    render(<Page />);
    fireEvent.click(screen.getByText('Open'));
    expect(document.body.style.overflow).toBe('hidden');
    const writes = style.mock.calls.length;
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('Re-render parent'));
    expect(style.mock.calls.length).toBe(writes); // no unlock / re-lock churn on re-render
    fireEvent.click(screen.getByText('Cancel'));
    expect(document.body.style.overflow).toBe('');
    style.mockRestore();
  });

  it('closes on Escape using the latest onClose, and can be reopened', () => {
    render(<Page />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes when the backdrop (not the panel) is pressed', () => {
    render(<Page />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.mouseDown(document.querySelector('.modal-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ActionMenu', () => {
  it('draws its list in <body> so a scrolling table cannot clip it, and runs the chosen action', () => {
    const onSelect = vi.fn();
    render(<div style={{ overflow: 'auto' }} data-testid="scroller"><ActionMenu items={[{ label: 'Complete…', onSelect }, { label: 'Hidden', hidden: true }]} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = screen.getByRole('menu');
    expect(screen.getByTestId('scroller').contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(screen.queryByText('Hidden')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Complete…' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on an outside press, but not when pressing inside its list', () => {
    render(<ActionMenu items={[{ label: 'One' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
