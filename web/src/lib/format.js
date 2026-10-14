export function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric'
  });
}
export function formatDelta(pct, unit) {
  const value = Number.isInteger(pct) ? pct : pct.toFixed(1);
  return unit === 'pt' ? `${value}pt` : `${value}%`;
}
export function formatInrCompact(value) {
  if (value >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)} Cr`;
  if (value >= 1_00_000) return `₹${(value / 1_00_000).toFixed(1)} L`;
  return `₹${value.toLocaleString('en-IN')}`;
}

// Full-precision rupee amount (e.g. ₹12,50,000) — for receipts/installment
// rows where formatInrCompact's L/Cr rounding would hide the exact figure.
export function formatInr(value) {
  return `₹${Math.round(value ?? 0).toLocaleString('en-IN')}`;
}

export function formatDateFull(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRelativeTime(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return formatDateFull(iso);
}

export function formatDuration(totalSeconds) {
  if (!totalSeconds) return '—';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function phoneDigits(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

// Backend numbers arrive inconsistently — sometimes with an India country
// code, sometimes without, sometimes with a US/Canada one — so this can only
// pattern-match common shapes rather than parse a real E.164 country table.
export function formatPhone(raw) {
  const digits = phoneDigits(raw);
  if (!digits) return '—';
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return `+${digits}`;
}