/**
 * The ONLY placeholders a WhatsApp template body may contain. They are defined here, in code, because they are the contract
 * with whatever will later fill them in from business records; administrators choose among them but cannot invent new ones.
 * Nothing here sends anything: V1 only stores templates.
 *
 * `unit_location_url` is the deliberate hook for sharing a unit's exact location later (units already store latitude and
 * longitude); images and documents can be attached later without changing the body format.
 */
export const TEMPLATE_VARIABLES = [
  { key: 'client_name', label: 'Customer name', description: "The person's name" },
  { key: 'enquiry_no', label: 'Enquiry number', description: 'For example ENQ-000042' },
  { key: 'unit_name', label: 'Unit name', description: 'The unit or property name' },
  { key: 'unit_code', label: 'Unit number', description: 'For example UNT-000042' },
  { key: 'unit_price', label: 'Unit price', description: 'The expected price of the unit' },
  { key: 'unit_location_url', label: 'Unit location link', description: "A map link built from the unit's coordinates" },
  { key: 'visit_datetime', label: 'Site visit date and time', description: 'When the site visit is scheduled' },
  { key: 'booking_no', label: 'Booking number', description: 'For example BK-000042' },
  { key: 'booking_date', label: 'Booking date', description: 'When the unit was booked' },
  { key: 'branch_name', label: 'Branch name', description: 'The branch handling the customer' },
  { key: 'employee_name', label: 'Employee name', description: 'The salesperson looking after the customer' },
] as const;

export type TemplateVariableKey = (typeof TEMPLATE_VARIABLES)[number]['key'];
const ALLOWED = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.key));

export const MAX_TEMPLATE_BODY = 1024;

export interface TemplateIssue {
  message: string;
}

export interface TemplateAnalysis {
  /** Distinct placeholders used, in order of first appearance. */
  variables: TemplateVariableKey[];
  issues: TemplateIssue[];
}

/**
 * Reads a template body and reports every problem at once:
 *  - a placeholder is exactly `{{name}}` with a lower-case snake_case name (no spaces, no empty, no nesting);
 *  - the name must be one of TEMPLATE_VARIABLES;
 *  - any other `{` or `}` is a malformed (unbalanced) placeholder, so a typo can never reach a customer as raw braces.
 */
export function analyzeTemplate(body: string): TemplateAnalysis {
  const issues: TemplateIssue[] = [];
  const variables: TemplateVariableKey[] = [];
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const malformed = new Set<string>();

  let rest = '';
  let last = 0;
  for (const m of body.matchAll(/\{\{([^{}]*)\}\}/g)) {
    rest += body.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    const name = m[1] ?? '';
    if (!/^[a-z][a-z0-9_]*$/.test(name)) malformed.add(m[0]);
    else if (!ALLOWED.has(name)) unknown.add(name);
    else if (!seen.has(name)) {
      seen.add(name);
      variables.push(name as TemplateVariableKey);
    }
  }
  rest += body.slice(last);
  if (/[{}]/.test(rest)) malformed.add('a stray "{" or "}"');

  for (const m of malformed) issues.push({ message: `Malformed placeholder ${m}. Write placeholders as {{name}} in lower case, with no spaces.` });
  for (const n of unknown) issues.push({ message: `Unsupported placeholder {{${n}}}. Choose one from the list of supported placeholders.` });
  return { variables, issues };
}
