import './charts2.css';

/** Vertical columns for a few categories: `items: [{ key, label, value, color }]`. Heights are relative to the largest value. */
export function ColumnChart({ items, height = 150, ariaLabel }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="cols" role="img" aria-label={ariaLabel} style={{ '--h': `${height}px` }}>
      {items.map((i) => (
        <div key={i.key} className="col" title={`${i.label}: ${i.value.toLocaleString('en-IN')}`}>
          <span className="col-value">{i.value.toLocaleString('en-IN')}</span>
          <span className="col-bar-wrap">
            <span className="col-bar" style={{ height: `${(i.value / max) * 100}%`, background: `linear-gradient(180deg, color-mix(in srgb, ${i.color} 62%, white), ${i.color})` }} />
          </span>
          <span className="col-label">{i.label}</span>
        </div>
      ))}
    </div>
  );
}
