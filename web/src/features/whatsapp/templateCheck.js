/**
 * Instant feedback while typing, using the supported placeholders the SERVER published. It only mirrors the server's rule
 * to save a round trip; the server checks again and decides.
 */
export function checkBody(body, allowedKeys) {
  const issues = [];
  const allowed = new Set(allowedKeys);
  let rest = '';
  let last = 0;
  for (const m of body.matchAll(/\{\{([^{}]*)\}\}/g)) {
    rest += body.slice(last, m.index);
    last = m.index + m[0].length;
    const name = m[1];
    if (!/^[a-z][a-z0-9_]*$/.test(name)) issues.push(`Malformed placeholder ${m[0]}. Write placeholders as {{name}} in lower case, with no spaces.`);
    else if (allowed.size && !allowed.has(name)) issues.push(`Unsupported placeholder {{${name}}}.`);
  }
  rest += body.slice(last);
  if (/[{}]/.test(rest)) issues.push('Malformed placeholder: a stray "{" or "}".');
  return [...new Set(issues)];
}
