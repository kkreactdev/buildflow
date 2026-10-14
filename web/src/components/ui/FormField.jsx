import './FormControls.css';

export function FormField({ label, htmlFor, required, hint, error, className, children }) {
  return (
    <div className={`form-field ${className ?? ''}`}>
      {label && (
        <label htmlFor={htmlFor} className="form-label">
          {label}
          {required && <span className="form-required">*</span>}
        </label>
      )}
      {children}
      {error ? <span className="form-error">{error}</span> : hint ? <span className="form-hint">{hint}</span> : null}
    </div>
  );
}
