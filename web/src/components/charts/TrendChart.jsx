import { useId, useRef, useState } from 'react';
import { formatDate } from '../../lib/format';
import { areaPath, linePath, niceTicks, roundedTopRectPath, scalePoints } from './scale';
import './TrendChart.css';
const W = 640;
const H = 165;
const MARGIN_LEFT = 60;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 24;
const PLOT_W = W - MARGIN_LEFT;
const PLOT_H = H - MARGIN_TOP - MARGIN_BOTTOM;
export function TrendChart({
  data,
  valueFormatter = v => v.toFixed(2),
  tickFormatter = v => v.toFixed(1),
  unit,
  variant = 'line'
}) {
  const gradientId = useId();
  const glowGradientId = useId();
  const glowFilterId = useId();
  const barGradientId = useId();
  const wrapRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  if (!data || data.length === 0) return null;

  const values = data.map(d => d.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || 1;
  // Pad the plotted domain a little past the data itself (so the line never
  // touches the card edge) instead of snapping straight to whichever "nice"
  // gridline value happens to round outward — that rounding was what left a
  // third of the chart empty when the data only spans a few tenths.
  const pad = Math.max(span * 0.12, rawMax * 0.01, 0.01);
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;
  const domainRange = domainMax - domainMin || 1;
  const allTicks = niceTicks(rawMin, rawMax, 4);
  const ticks = allTicks.filter(t => t >= domainMin && t <= domainMax);
  const visibleTicks = ticks.length > 0 ? ticks : allTicks;

  // Deduplicate ticks that format to identical strings or collide vertically (< 18px)
  const seenLabels = new Set();
  const renderedTicks = [];
  for (const tick of visibleTicks) {
    const label = tickFormatter ? tickFormatter(tick) : String(tick);
    const y = MARGIN_TOP + (1 - (tick - domainMin) / domainRange) * PLOT_H;
    if (seenLabels.has(label)) continue;
    if (renderedTicks.some(prev => Math.abs(prev.y - y) < 18)) continue;
    seenLabels.add(label);
    renderedTicks.push({ tick, label, y });
  }
  const rawPts = scalePoints(data.map(d => ({
    date: d.date,
    value: d.value
  })), PLOT_W, PLOT_H, 0);
  // Re-derive y against the padded domain (not raw min/max) so the line/area
  // fill the plot area tightly while gridlines still land on clean values.
  const pts = rawPts.map(p => ({
    ...p,
    x: p.x + MARGIN_LEFT,
    y: MARGIN_TOP + (1 - (p.value - domainMin) / domainRange) * PLOT_H
  }));
  function handleMove(e) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const plotPixelStart = MARGIN_LEFT / W * rect.width;
    const plotPixelWidth = PLOT_W / W * rect.width;
    const fraction = (e.clientX - rect.left - plotPixelStart) / plotPixelWidth;
    const clamped = Math.min(1, Math.max(0, fraction));
    const idx = Math.round(clamped * (data.length - 1));
    setHoverIndex(idx);
  }
  const hovered = hoverIndex !== null ? pts[hoverIndex] : null;
  const hoveredPrevValue = hoverIndex !== null && hoverIndex > 0 ? data[hoverIndex - 1]?.value : null;
  const hoveredDeltaPct = hoveredPrevValue != null && hoveredPrevValue !== 0 ? ((hovered.value - hoveredPrevValue) / hoveredPrevValue) * 100 : null;
  return <div className="trend-chart" ref={wrapRef} style={{
    aspectRatio: `${W} / ${H}`
  }} onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--trend-neon)" stopOpacity="0.34" />
            <stop offset="52%" stopColor="var(--accent)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={glowGradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--trend-neon)" />
          </linearGradient>
          <filter id={glowFilterId} x="-24%" y="-80%" width="148%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={barGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="100%" stopColor="var(--color-primary-strong)" />
          </linearGradient>
        </defs>

        {renderedTicks.map(({ tick, label, y }) => (
          <g key={tick}>
            <line x1={MARGIN_LEFT} x2={W} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={MARGIN_LEFT - 8} y={y} textAnchor="end" dominantBaseline="middle" className="trend-chart-tick">
              {label}
            </text>
          </g>
        ))}

        {variant === 'bar' ? (
          <g className="trend-bar-group">
            {pts.map((p, i) => {
              const barWidth = (pts.length > 1 ? pts[1].x - pts[0].x : PLOT_W) * 0.55;
              const barHeight = MARGIN_TOP + PLOT_H - p.y;
              return (
                <path
                  key={i}
                  d={roundedTopRectPath(p.x - barWidth / 2, p.y, barWidth, barHeight, 4)}
                  fill={`url(#${barGradientId})`}
                  className={`trend-bar ${i === hoverIndex ? 'is-hovered' : ''}`}
                />
              );
            })}
          </g>
        ) : (
          <>
            <path className="trend-area-path" d={areaPath(pts, MARGIN_TOP + PLOT_H)} fill={`url(#${gradientId})`} stroke="none" />
            <path className="trend-line-path" d={linePath(pts)} fill="none" stroke={`url(#${glowGradientId})`} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 3 : 2} className="trend-chart-point" />)}
          </>
        )}

        <text x={pts[0]?.x ?? MARGIN_LEFT} y={H - 6} textAnchor="start" className="trend-chart-tick">
          {formatDate(data[0]?.date ?? '')}
        </text>
        <text x={pts[pts.length - 1]?.x ?? W} y={H - 6} textAnchor="end" className="trend-chart-tick">
          {formatDate(data[data.length - 1]?.date ?? '')}
        </text>

        {hovered && <g className="trend-chart-hover">
            <line x1={hovered.x} x2={hovered.x} y1={MARGIN_TOP} y2={MARGIN_TOP + PLOT_H} className="trend-chart-crosshair" />
            <circle cx={hovered.x} cy={hovered.y} r={11} className="trend-chart-dot-glow" filter={`url(#${glowFilterId})`} />
            <circle cx={hovered.x} cy={hovered.y} r={4.5} className="trend-chart-dot" />
          </g>}
      </svg>

      {hovered && <div className="trend-chart-tooltip" style={{
      left: `${hovered.x / W * 100}%`,
      top: `${hovered.y / H * 100}%`
    }}>
          <span className="trend-chart-tooltip-date">{formatDate(hovered.date)}</span>
          <span className="trend-chart-tooltip-value mono">
            {unit ? `${unit} ` : ''}
            {valueFormatter(hovered.value)}
          </span>
          {hoveredDeltaPct != null && <span className={`trend-chart-tooltip-delta ${hoveredDeltaPct >= 0 ? 'is-good' : 'is-bad'}`}>
              {hoveredDeltaPct >= 0 ? '↑' : '↓'} {Math.abs(hoveredDeltaPct).toFixed(1)}% vs prior day
            </span>}
        </div>}
    </div>;
}