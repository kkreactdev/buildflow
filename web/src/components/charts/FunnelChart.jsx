import { Link } from 'react-router-dom';
import './funnel.css';

const TONES = ['#34d399', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#0e7490', '#0369a1', '#1d4ed8'];

/**
 * A funnel of configured stages, in order. Each band's width is proportional to its own count (relative to the largest), so a
 * stage with MORE than the one above it, which a workflow that allows moving back can produce, is drawn honestly wider; the
 * connecting edge never exceeds the narrower neighbour. No rates are computed here.
 *   stages: [{ key, label, value, to? }]
 */
export function FunnelChart({ stages, ariaLabel, unit = 'enquiries' }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  const width = (v) => Math.max(14, (v / max) * 100); // a minimum so zero / tiny stages stay visible and labelled
  return (
    <ol className="funnel" aria-label={ariaLabel}>
      {stages.map((s, i) => {
        const top = width(s.value);
        const next = i < stages.length - 1 ? width(stages[i + 1].value) : top * 0.82;
        const bottom = Math.min(top, next);
        const clip = `polygon(${50 - top / 2}% 0, ${50 + top / 2}% 0, ${50 + bottom / 2}% 100%, ${50 - bottom / 2}% 100%)`;
        const label = <><span className="funnel-name">{s.label}</span><strong className="funnel-count">{s.value.toLocaleString('en-IN')}</strong></>;
        return (
          <li key={s.key} className="funnel-row" title={`${s.label}: ${s.value.toLocaleString('en-IN')} ${unit}`}>
            <div className="funnel-band-wrap">
              <div className="funnel-band" style={{ clipPath: clip, background: `linear-gradient(180deg, ${TONES[i % TONES.length]}, color-mix(in srgb, ${TONES[i % TONES.length]} 78%, #000))`, animationDelay: `${i * 70}ms` }}>
                <span>{s.value.toLocaleString('en-IN')}</span>
              </div>
            </div>
            {s.to ? <Link to={s.to} className="funnel-label">{label}</Link> : <div className="funnel-label">{label}</div>}
          </li>
        );
      })}
    </ol>
  );
}
