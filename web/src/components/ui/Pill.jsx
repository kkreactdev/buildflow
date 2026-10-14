import './Pill.css';
export function Pill({
  label,
  color,
  bg,
  dot,
  solid,
  bold,
  mono,
  icon,
  size = 'md',
  className
}) {
  const style = {
    ...(color ? {
      color: solid ? color : color
    } : {}),
    ...(bg ? {
      background: bg
    } : {})
  };
  return <span className={['pill', `pill-${size}`, solid ? 'pill-solid' : '', bold ? 'pill-bold' : '', mono ? 'pill-mono' : '', className ?? ''].filter(Boolean).join(' ')} style={style}>
      {dot && <span className="pill-dot" style={{
      background: color
    }} />}
      {icon}
      {label}
    </span>;
}