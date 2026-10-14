import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone, phoneSearchDigits } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
    ['98765.43210', '+919876543210'],
    ['09876543210', '+919876543210'], // trunk prefix
    ['919876543210', '+919876543210'], // country code without +
    ['+91 98765 43210', '+919876543210'],
    ['+91-9876543210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'], // 00 international prefix
    ['  +919876543210  ', '+919876543210'],
    ['+14155552671', '+14155552671'], // other countries stay as given
    ['+44 20 7946 0958', '+442079460958'],
    ['0044 20 7946 0958', '+442079460958'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('every notation of one number yields the SAME identity key', () => {
    const forms = ['9876543210', '+91 98765 43210', '098765 43210', '91-98765-43210', '0091 9876543210', '(+91) 98765 43210'];
    expect(new Set(forms.map((f) => normalizePhone(f))).size).toBe(1);
  });

  it.each([
    '', '   ', 'abc', '98765abc10', '9876543210 ext 12', '12345', '987654321', '98765432101', // wrong lengths
    '0000000000', '9999999999', '0123456789', // junk national numbers
    '+', '+0123456789', '+91', '+1234567', '+1234567890123456', // bad international
    '98+76543210', '+91+9876543210', '++919876543210',
  ])('rejects %j', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 9876543210, {}, []]) expect(normalizePhone(v)).toBeNull();
  });

  it('honours a different default country code', () => {
    expect(normalizePhone('9876543210', '44')).toBe('+449876543210');
    expect(normalizePhone('449876543210', '44')).toBe('+449876543210');
  });
});

describe('formatPhone / phoneSearchDigits', () => {
  it('formats Indian numbers readably and leaves others as E.164', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone('+14155552671')).toBe('+14155552671');
  });
  it('extracts digits only when the search text looks like a phone number', () => {
    expect(phoneSearchDigits('98765')).toBe('98765');
    expect(phoneSearchDigits('+91 98765 4')).toBe('91987654');
    expect(phoneSearchDigits('98')).toBeNull(); // too short to be useful
    expect(phoneSearchDigits('Raj Kumar')).toBeNull();
    expect(phoneSearchDigits('CL-000012')).toBeNull();
    expect(phoneSearchDigits('098765 43210')).toBe('9876543210'); // trunk prefix on a full number
    expect(phoneSearchDigits('0098')).toBe('0098'); // short partials are left alone
  });
});
