/**
 * Canonical phone handling. Phone number is the primary identity signal, so
 * EVERY comparison, lookup, uniqueness check and storage goes through
 * `normalizePhone`, which yields strict E.164 (`+919876543210`) or `null`.
 *
 * Accepted: `+<country><number>`, `00<country><number>`, a 10-digit national
 * number (default country calling code is added), `0` + 10 digits (trunk
 * prefix dropped), and `<default cc><10 digits>` without the plus. Spaces,
 * dashes, dots and parentheses are ignored. Anything else (letters, extensions,
 * wrong lengths) is invalid rather than guessed.
 */
const NATIONAL_LENGTH = 10;
const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(raw: unknown, defaultCountryCode = '91'): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[+\d\s().-]+$/.test(trimmed)) return null;
  // Formatting characters are noise; after removing them a '+' may only appear once, at the start.
  const s = trimmed.replace(/[\s().-]/g, '');
  if (s.includes('+') && !(s.startsWith('+') && s.indexOf('+', 1) === -1)) return null;

  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  if (s.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.length === NATIONAL_LENGTH) {
    if (!isPlausibleNational(digits)) return null;
    digits = defaultCountryCode + digits;
  } else if (digits.length === NATIONAL_LENGTH + 1 && digits.startsWith('0')) {
    const national = digits.slice(1);
    if (!isPlausibleNational(national)) return null;
    digits = defaultCountryCode + national;
  } else if (digits.startsWith(defaultCountryCode) && digits.length === defaultCountryCode.length + NATIONAL_LENGTH) {
    if (!isPlausibleNational(digits.slice(defaultCountryCode.length))) return null;
  } else {
    return null;
  }

  const e164 = `+${digits}`;
  return E164.test(e164) ? e164 : null;
}

/** Rejects obvious junk: leading zero, or one repeated digit (0000000000, 9999999999). */
function isPlausibleNational(n: string): boolean {
  return n[0] !== '0' && !/^(\d)\1+$/.test(n);
}

/** `+919876543210` -> `+91 98765 43210`; other countries stay as plain E.164. */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/**
 * Digits to search for when a free-text search box looks like (part of) a phone number; otherwise null.
 * A full number typed with the national trunk prefix (`098765 43210`) drops that leading zero so it
 * still matches the stored `+91…` form.
 */
export function phoneSearchDigits(q: string): string | null {
  if (!/^[+\d\s().-]+$/.test(q.trim())) return null;
  const digits = q.replace(/\D/g, '');
  if (digits.length < 3) return null;
  return digits.length >= 10 && digits.startsWith('0') && !digits.startsWith('00') ? digits.replace(/^0+/, '') : digits;
}
