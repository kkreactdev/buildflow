import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { MoreVerticalIcon } from './icons';
import './ActionMenu.css';

/**
 * Kebab menu. `items`: `[{ label, onSelect, icon?, danger?, hidden?, disabled? }]`.
 * Callers pass `hidden: !can('x.y')` so unavailable actions are not offered;
 * the API still enforces the permission.
 */
export function ActionMenu({ items, label = 'Actions', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const listRef = useRef(null);
  const [pos, setPos] = useState(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false);
    };
    const onMove = () => setOpen(false); // a fixed menu would drift away from its button
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // The list is drawn in <body> at fixed coordinates, so no scrolling table container or card can clip it. It opens below the
  // button, or above when there is no room, and stays inside the window horizontally.
  useLayoutEffect(() => {
    if (!open || !ref.current || !listRef.current) return;
    const b = ref.current.getBoundingClientRect();
    const l = listRef.current.getBoundingClientRect();
    const below = b.bottom + 4 + l.height <= window.innerHeight - 8;
    const top = below ? b.bottom + 4 : Math.max(8, b.top - 4 - l.height);
    const left = Math.min(Math.max(8, align === 'right' ? b.right - l.width : b.left), window.innerWidth - l.width - 8);
    setPos({ top, left });
  }, [open, align, visible.length]);

  if (visible.length === 0) return null;

  return (
    <div className="action-menu" ref={ref}>
      <IconButton icon={<MoreVerticalIcon size={16} />} label={label} size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => { setPos(null); setOpen((o) => !o); }} />
      {open && createPortal(
        <ul ref={listRef} className="action-menu-list" role="menu" style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
          {visible.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`action-menu-item ${item.danger ? 'is-danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
