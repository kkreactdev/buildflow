import { useState } from 'react';
import './DonutChart.css';

export function DonutChart({
  data = [], // [{ name, value, pct, color }]
  size = 220,
  innerRadiusRatio = 0.62,
  centerLabel = 'Total',
  unit = '',
  centerValue,
  onHoverSegment,
}) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const total = data.reduce((acc, d) => acc + (d.value || 0), 0);
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = (size / 2) - 16;
  const innerRadius = outerRadius * innerRadiusRatio;

  // Filter valid data items
  const validData = data.filter((d) => (d.value || 0) > 0);

  // If no data
  if (total === 0 || validData.length === 0) {
    return (
      <div className="donut-chart-empty" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={cx}
            cy={cy}
            r={outerRadius}
            fill="none"
            stroke="var(--surface-3, #e2e8f0)"
            strokeWidth={outerRadius - innerRadius}
            strokeDasharray="4 4"
          />
        </svg>
        <div className="donut-center-content">
          <span className="donut-center-sub">No data</span>
        </div>
      </div>
    );
  }

  // Handle single item (100% donut)
  const isSingleItem = validData.length === 1;

  // Compute slice angles
  const angles = validData.map((item) => (item.value / total) * 2 * Math.PI);
  // Start from top (12 o'clock); each slice begins where the previous ended.
  const startAngles = angles.reduce((acc, a, i) => {
    acc.push(i === 0 ? -Math.PI / 2 : acc[i - 1] + angles[i - 1]);
    return acc;
  }, []);
  const slices = validData.map((item, index) => {
    const fraction = item.value / total;
    const angle = angles[index];
    const startAngle = startAngles[index];
    const endAngle = startAngle + angle;

    const isHovered = hoveredIdx === index;
    const currentOuterRadius = isHovered ? outerRadius + 6 : outerRadius;
    const currentInnerRadius = isHovered ? innerRadius - 2 : innerRadius;

    let pathData = '';
    if (isSingleItem || fraction >= 0.999) {
      // Full ring: two semicircular arcs
      const midAngle = startAngle + Math.PI;
      pathData = `
        M ${cx + currentOuterRadius * Math.cos(startAngle)} ${cy + currentOuterRadius * Math.sin(startAngle)}
        A ${currentOuterRadius} ${currentOuterRadius} 0 1 1 ${cx + currentOuterRadius * Math.cos(midAngle)} ${cy + currentOuterRadius * Math.sin(midAngle)}
        A ${currentOuterRadius} ${currentOuterRadius} 0 1 1 ${cx + currentOuterRadius * Math.cos(startAngle)} ${cy + currentOuterRadius * Math.sin(startAngle)}
        M ${cx + currentInnerRadius * Math.cos(startAngle)} ${cy + currentInnerRadius * Math.sin(startAngle)}
        A ${currentInnerRadius} ${currentInnerRadius} 0 1 0 ${cx + currentInnerRadius * Math.cos(midAngle)} ${cy + currentInnerRadius * Math.sin(midAngle)}
        A ${currentInnerRadius} ${currentInnerRadius} 0 1 0 ${cx + currentInnerRadius * Math.cos(startAngle)} ${cy + currentInnerRadius * Math.sin(startAngle)}
        Z
      `;
    } else {
      const x1 = cx + currentOuterRadius * Math.cos(startAngle);
      const y1 = cy + currentOuterRadius * Math.sin(startAngle);
      const x2 = cx + currentOuterRadius * Math.cos(endAngle);
      const y2 = cy + currentOuterRadius * Math.sin(endAngle);
      const x3 = cx + currentInnerRadius * Math.cos(endAngle);
      const y3 = cy + currentInnerRadius * Math.sin(endAngle);
      const x4 = cx + currentInnerRadius * Math.cos(startAngle);
      const y4 = cy + currentInnerRadius * Math.sin(startAngle);
      const largeArc = angle > Math.PI ? 1 : 0;

      pathData = `
        M ${x1} ${y1}
        A ${currentOuterRadius} ${currentOuterRadius} 0 ${largeArc} 1 ${x2} ${y2}
        L ${x3} ${y3}
        A ${currentInnerRadius} ${currentInnerRadius} 0 ${largeArc} 0 ${x4} ${y4}
        Z
      `;
    }

    return {
      ...item,
      index,
      pathData,
      isHovered,
      pct: ((item.value / total) * 100).toFixed(1),
    };
  });

  const activeItem = hoveredIdx !== null ? slices[hoveredIdx] : null;

  return (
    <div className="donut-chart-container" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="donut-svg"
        aria-label="Donut Chart"
      >
        <defs>
          <filter id="donut-slice-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.2" />
          </filter>
        </defs>

        {slices.map((slice) => (
          <path
            key={slice.name || slice.index}
            d={slice.pathData}
            fill={slice.color || 'var(--accent)'}
            stroke="var(--surface, #ffffff)"
            strokeWidth="2.5"
            className={`donut-slice ${slice.isHovered ? 'is-hovered' : ''}`}
            filter={slice.isHovered ? 'url(#donut-slice-shadow)' : undefined}
            onMouseEnter={() => {
              setHoveredIdx(slice.index);
              onHoverSegment?.(slice);
            }}
            onMouseLeave={() => {
              setHoveredIdx(null);
              onHoverSegment?.(null);
            }}
          >
            <title>{`${slice.name}: ${slice.value.toLocaleString('en-IN')} (${slice.pct}%)`}</title>
          </path>
        ))}
      </svg>

      {/* Center Label / Value */}
      <div className="donut-center-content" style={{ pointerEvents: 'none' }}>
        {activeItem ? (
          <>
            <strong className="donut-center-val" style={{ color: activeItem.color }}>
              {activeItem.pct}%
            </strong>
            <span className="donut-center-name">{activeItem.name}</span>
            <span className="donut-center-count mono">{activeItem.value.toLocaleString()}{unit ? ` ${unit}` : ''}</span>
          </>
        ) : (
          <>
            <strong className="donut-center-val">
              {centerValue !== undefined ? centerValue.toLocaleString() : total.toLocaleString()}
            </strong>
            <span className="donut-center-sub">{centerLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
