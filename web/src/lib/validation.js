// Small, dependency-free client-side validation. The server (zod) is the
// source of truth; these rules only give instant feedback before submit.

export const rules = {
  required: (message = 'Required') => (v) => (v === undefined || v === null || String(v).trim() === '' ? message : null),
  minLength: (n, message) => (v) => (v && String(v).trim().length < n ? message ?? `At least ${n} characters` : null),
  maxLength: (n, message) => (v) => (v && String(v).length > n ? message ?? `At most ${n} characters` : null),
  email: (message = 'Enter a valid email') => (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? message : null),
  phone: (message = 'Enter a valid phone number') => (v) => {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, '');
    return digits.length < 8 || digits.length > 15 ? message : null;
  },
  number: (message = 'Enter a number') => (v) => (v !== '' && v != null && Number.isNaN(Number(v)) ? message : null),
};

/** `schema` is `{ field: [rule, ...] }`. Returns `{ field: message }` (empty = valid). */
export function validate(values, schema) {
  const errors = {};
  for (const [field, fieldRules] of Object.entries(schema)) {
    // Schema keys may be dotted paths (`property.name`) so nested form values can be validated by the
    // same mechanism as flat ones, and so the key matches the `path` the server sends in validation
    // errors — which is what lets a server `details[].path` land on the right field.
    const value = field.includes('.') ? field.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), values) : values[field];
    for (const rule of fieldRules) {
      const message = rule(value, values);
      if (message) {
        errors[field] = message;
        break;
      }
    }
  }
  return errors;
}
