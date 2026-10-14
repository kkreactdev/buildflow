import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';
import './Modal.css';

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useDialogBehavior(open, onClose);

  if (!open) return null;

  // Rendered into <body>, never inside the page: a position:fixed dialog inside any ancestor that has a transform (a hovered
  // card lifts with translateY), filter or containment is positioned against THAT ancestor. That made the dialog change size
  // and position whenever the pointer crossed the card's edge, which looked like flickering.
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal-panel modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <span className="modal-subtitle">{subtitle}</span>}
          </div>
          <IconButton icon={<CloseIcon size={16} />} label="Close" onClick={onClose} size="sm" />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
