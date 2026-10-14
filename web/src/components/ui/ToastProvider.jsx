import { useCallback, useMemo, useRef, useState } from 'react';
import { ToastContext } from './toastContext';
import { CheckIcon, CloseIcon, AlertTriangleIcon, InfoIcon } from './icons';
import './Toast.css';

const DEFAULT_DURATION = 3800;
const ICONS = {
  success: CheckIcon,
  error: AlertTriangleIcon,
  info: InfoIcon,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, { type = 'info', duration = DEFAULT_DURATION } = {}) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, type }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (message, opts) => push(message, { ...opts, type: 'success' }),
      error: (message, opts) => push(message, { ...opts, type: 'error' }),
      info: (message, opts) => push(message, { ...opts, type: 'info' }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] ?? InfoIcon;
          return (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <span className="toast-icon">
                <Icon size={16} />
              </span>
              <span className="toast-message">{t.message}</span>
              <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <CloseIcon size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
