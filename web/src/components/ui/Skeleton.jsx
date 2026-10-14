import './Skeleton.css';

export function Skeleton({ width = '100%', height = 14, radius, circle = false, className, style, ...rest }) {
  return (
    <span
      className={`skeleton ${className ?? ''}`}
      style={{
        width,
        height,
        borderRadius: circle ? '50%' : radius,
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    />
  );
}
