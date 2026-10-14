import './Avatar.css';
export function Avatar({
  initials,
  size = 'md'
}) {
  return <div className={`avatar avatar-${size}`}>{initials}</div>;
}