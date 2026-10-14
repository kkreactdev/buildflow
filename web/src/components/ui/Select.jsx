import './FormControls.css';

export function Select({ className, children, ...rest }) {
  return (
    <select className={`form-control form-select ${className ?? ''}`} {...rest}>
      {children}
    </select>
  );
}
