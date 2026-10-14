import './Button.css';
export function Button({
  variant = 'primary',
  icon,
  children,
  className,
  ...rest
}) {
  return <button className={`btn btn-${variant} ${className ?? ''}`} {...rest}>
      {icon}
      {children}
    </button>;
}