import './FormControls.css';

export function Textarea({ className, ...rest }) {
  return <textarea className={`form-control form-textarea ${className ?? ''}`} {...rest} />;
}
