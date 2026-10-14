import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';
import './Drawer.css';

export function Drawer({ open, onClose, title, subtitle, headerActions, children }) {
  useDialogBehavior(open, onClose);

  if (!open) return null;

  // In <body>, for the same reason as Modal (a transformed ancestor would trap and resize a fixed overlay).
  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-header">
          <div className="drawer-header-text">
            <h2>{title}</h2>
            {subtitle && <span className="drawer-subtitle">{subtitle}</span>}
          </div>
          <div className="drawer-header-actions">
            {headerActions}
            <IconButton icon={<CloseIcon size={16} />} label="Close" onClick={onClose} size="sm" />
          </div>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
