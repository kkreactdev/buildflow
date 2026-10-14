import './FormControls.css';

export function Input({ className, ...rest }) {
  return <input className={`form-control ${className ?? ''}`} {...rest} />;
}
