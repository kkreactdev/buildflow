import './IconButton.css';
export function IconButton({
  icon,
  label,
  variant = 'default',
  size = 'md',
  className,
  ...rest
}) {
  return <button type="button" className={`icon-btn icon-btn-${variant} icon-btn-${size} ${className ?? ''}`} aria-label={label} title={label} {...rest}>
      {icon}
    </button>;
}