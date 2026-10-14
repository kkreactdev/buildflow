import './charts2.css';

/**
 * Horizontal bars for categories with long labels (e.g. workflow stages). `series` names the measures drawn per row:
 *   rows: [{ key, label, values: { current: 5, entered: 12 }, hint }]  series: [{ key, label, color }]
 * Widths are relative to the largest value; every bar carries its exact value as text and as a tooltip.
 */
export function HBarChart({ rows, series, ariaLabel }) {
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => r.values[s.key] ?? 0)));
  return (
    <div className="hbar" role="img" aria-label={ariaLabel}>
      {series.length > 1 && (
        <ul className="chart-legend" aria-hidden="true">
          {series.map((s) => <li key={s.key}><span style={{ background: s.color }} />{s.label}</li>)}
        </ul>
      )}
      {rows.map((r) => (
        <div key={r.key} className="hbar-row">
          <span className="hbar-label" title={r.label}>{r.label}</span>
          <div className="hbar-tracks">
            {series.map((s) => {
              const v = r.values[s.key] ?? 0;
              return (
                <div key={s.key} className="hbar-track" title={`${r.label} · ${s.label}: ${v.toLocaleString('en-IN')}`}>
                  <span className="hbar-fill" style={{ width: `${(v / max) * 100}%`, background: `linear-gradient(90deg, ${s.color}, color-mix(in srgb, ${s.color} 60%, white))` }} />
                  <span className="hbar-value">{v.toLocaleString('en-IN')}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
