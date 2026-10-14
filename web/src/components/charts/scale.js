export function scalePoints(points, width, height, paddingY = 4) {
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  return points.map((p, i) => {
    const x = i * stepX;
    const norm = (p.value - min) / range;
    const y = paddingY + (1 - norm) * (height - paddingY * 2);
    return {
      ...p,
      x,
      y
    };
  });
}
export function linePath(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}
export function areaPath(pts, height) {
  if (pts.length === 0) return '';
  const line = linePath(pts);
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${line} L${last.x.toFixed(2)},${height} L${first.x.toFixed(2)},${height} Z`;
}
// Bar mark anchored to the baseline: rounded top corners, flat bottom —
// matches the existing CSS bar convention (e.g. SalesPerformanceReport.css's
// "border-radius: 6px 6px 2px 2px"), just as an SVG path instead of a div.
export function roundedTopRectPath(x, y, width, height, radius) {
  if (height <= 0 || width <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  const top = y;
  const bottom = y + height;
  const left = x;
  const right = x + width;
  return `M${left},${bottom} L${left},${top + r} Q${left},${top} ${left + r},${top} L${right - r},${top} Q${right},${top} ${right},${top + r} L${right},${bottom} Z`;
}
export function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const span = max - min;
  const roughStep = span / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const residual = roughStep / magnitude;
  const niceResidual = residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1;
  const step = niceResidual * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Number(v.toFixed(4)));
  return ticks;
}