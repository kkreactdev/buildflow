/** The change against the previous period, as plain words (never a rate the data cannot support). */
export function deltaText(value, previous, prevLabel) {
  if (previous === undefined) return null;
  const diff = value - previous;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return `${diff === 0 ? 'No change' : `${sign}${Math.abs(diff)}`} vs ${previous} in ${prevLabel}`;
}
