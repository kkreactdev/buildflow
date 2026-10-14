import { useEffect, useRef } from 'react';

let activeDialogCount = 0;

/**
 * Force-reset any lingering body scroll locks (e.g. on route navigation).
 */
export function resetDialogScrollLock() {
  activeDialogCount = 0;
  if (typeof document !== 'undefined' && document.body) {
    document.body.style.overflow = '';
  }
}

/**
 * Handles Escape key closing and reference-counted body scroll locking
 * for Modals and Drawers so nested dialogs and navigation do not trap scroll.
 */
export function useDialogBehavior(open, onClose) {
  // Callers pass a new onClose function on every render. Keeping the latest one in a ref means the effect below depends only
  // on `open`: the scroll lock and key listener are set up once per opening, not torn down and rebuilt on every re-render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e) {
      if (e.key === 'Escape') closeRef.current?.();
    }

    document.addEventListener('keydown', onKeyDown);

    // Reference-counted body scroll lock: only lock when first dialog opens
    if (activeDialogCount === 0 && typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = 'hidden';
    }
    activeDialogCount++;

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      activeDialogCount = Math.max(0, activeDialogCount - 1);
      // Only unlock when all dialogs have closed
      if (activeDialogCount === 0 && typeof document !== 'undefined' && document.body) {
        document.body.style.overflow = '';
      }
    };
  }, [open]);
}
