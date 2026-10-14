import { useId } from 'react';
import './RangeMeter.css';

const SIZE = 220;
const CX = SIZE / 2;
const CY = SIZE / 2 + 4;
const RADIUS = 82;
const STROKE = 14;
const START_ANGLE = 180; // left end of the sweep
const END_ANGLE = 0; // right end of the sweep (passes through the top)

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

// Half-donut gauge arc — sweeps counter-clockwise from startAngle to
// endAngle through the top of the circle (matches how gauges read: left is
// empty, right is full).
function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = startAngle - endAngle <= 180 ? 0 : 1;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

// A single-value range meter (0-100) — the mark itself carries the whole
// story (one arc, one hue, a direct-labeled center figure), so unlike a
// multi-series chart it needs no legend and no per-point tooltip.
export function RangeMeter({ value, formattedValue, label, caption }) {
  const gradientId = useId();
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  const valueAngle = START_ANGLE - (clamped / 100) * (START_ANGLE - END_ANGLE);

  return (
    <div className="range-meter">
      <svg viewBox={`0 0 ${SIZE} ${SIZE / 2 + 30}`} className="range-meter-svg" role="img" aria-label={`${label}: ${formattedValue}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="100%" stopColor="var(--color-primary-strong)" />
          </linearGradient>
        </defs>

        <path d={arcPath(CX, CY, RADIUS, START_ANGLE, END_ANGLE)} className="range-meter-track" strokeWidth={STROKE} fill="none" />

        {clamped > 0 && (
          <path
            d={arcPath(CX, CY, RADIUS, START_ANGLE, valueAngle)}
            stroke={`url(#${gradientId})`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            className="range-meter-value"
          />
        )}

        <text x={CX} y={CY - 14} textAnchor="middle" className="range-meter-figure">
          {formattedValue}
        </text>
      </svg>
      <div className="range-meter-scale-row">
        <span className="range-meter-scale">0%</span>
        <span className="range-meter-scale">100%</span>
      </div>
      {caption && <p className="range-meter-caption">{caption}</p>}
    </div>
  );
}
