import { useId, useRef, useState } from 'react';
import { areaPath, linePath, scalePoints } from './scale';
import { formatDate } from '../../lib/format';
import './Sparkline.css';

export function Sparkline({
  data,
  width = 76,
  height = 32,
  color = 'var(--accent)',
  className = 'sparkline',
  preserveAspectRatio = 'xMidYMid meet',
  interactive = false,
  valueFormatter = (v) => v.toFixed(1),
}) {
  const gradientId = useId();
  const svgRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const pts = scalePoints(data, width, height, 3);
  const last = pts[pts.length - 1];
  const hovered = hoverIndex !== null ? pts[hoverIndex] : null;

  function handleMove(e) {
    if (!interactive || !svgRef.current || data.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(Math.min(1, Math.max(0, fraction)) * (data.length - 1));
    setHoverIndex(idx);
  }
  function handleLeave() {
    setHoverIndex(null);
  }

  return (
    <span className={`sparkline-wrap ${className} ${interactive ? 'is-interactive' : ''}`}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={preserveAspectRatio}
        aria-hidden="true"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath(pts, height)} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath(pts)} fill="none" stroke={color} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
        {hovered && <line x1={hovered.x} x2={hovered.x} y1={0} y2={height} className="sparkline-crosshair" />}
        {last && !hovered && <circle cx={last.x} cy={last.y} r={3.4} fill={color} stroke="var(--surface)" strokeWidth={1.75} className="sparkline-end-dot" />}
        {hovered && <circle cx={hovered.x} cy={hovered.y} r={3.6} fill={color} stroke="var(--surface)" strokeWidth={1.75} className="sparkline-hover-dot" />}
      </svg>
      {interactive && hovered && (
        <span className="sparkline-tooltip" style={{ left: `${(hovered.x / width) * 100}%` }}>
          <strong>{valueFormatter(hovered.value)}</strong>
          <span>{formatDate(hovered.date)}</span>
        </span>
      )}
    </span>
  );
}
