import './Card.css';
export function Card({
  padded = true,
  className,
  children,
  ...rest
}) {
  return <div className={`card ${padded ? 'card-padded' : ''} ${className ?? ''}`} {...rest}>
      {children}
    </div>;
}