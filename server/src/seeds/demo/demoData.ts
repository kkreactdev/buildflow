/**
 * The fictional demo dataset: pure data, no I/O. Every identity is invented: names are made up, phones are in the
 * 9000010xxx range, emails end in @demo.buildflow.test. Stable keys (phones, emails, unit names, branch codes) make the seed idempotent.
 */
export const DEMO_EMAIL_DOMAIN = 'demo.buildflow.test';
export const DEMO_BRANCH_PREFIX = 'DEMO-';

export const BRANCHES = [
  { code: 'DEMO-CHN', name: 'Chennai Central', address: '12 Lakeview Road, Chennai', phone: '+91 44 4000 1001' },
  { code: 'DEMO-CBE', name: 'Coimbatore West', address: '48 Hillside Avenue, Coimbatore', phone: '+91 422 400 1002' },
] as const;

/** Employees. `role` is a system role key; `branch` indexes BRANCHES (undefined = all branches). */
export const EMPLOYEES = [
  { key: 'admin', name: 'Anitha Raman', role: 'ADMIN', phone: '9000010101' },
  { key: 'mgr0', name: 'Karthik Subramanian', role: 'MANAGER', branch: 0, phone: '9000010102' },
  { key: 'mgr1', name: 'Divya Natarajan', role: 'MANAGER', branch: 1, phone: '9000010103' },
  { key: 's0', name: 'Arjun Venkatesh', role: 'SALES_EXECUTIVE', branch: 0, phone: '9000010104' },
  { key: 's1', name: 'Meera Krishnan', role: 'SALES_EXECUTIVE', branch: 0, phone: '9000010105' },
  { key: 's2', name: 'Rohit Balaji', role: 'SALES_EXECUTIVE', branch: 0, phone: '9000010106' },
  { key: 's3', name: 'Nisha Ramesh', role: 'SALES_EXECUTIVE', branch: 1, phone: '9000010107' },
  { key: 's4', name: 'Vikram Anand', role: 'SALES_EXECUTIVE', branch: 1, phone: '9000010108' },
  { key: 's5', name: 'Lakshmi Prabhu', role: 'SALES_EXECUTIVE', branch: 1, phone: '9000010109' },
] as const;
export const salesOf = (branch: 0 | 1) => EMPLOYEES.filter((e) => e.role === 'SALES_EXECUTIVE' && e.branch === branch).map((e) => e.key);

export const MASTER_VALUES = {
  ENQUIRY_SOURCE: ['Website', 'Walk-in', 'Referral', 'Facebook ad', 'Newspaper', 'Property portal'],
  ENQUIRY_TYPE: ['Purchase', 'Investment'],
  PROPERTY_TYPE: ['Villa', 'Apartment', 'Plot', 'Row house'],
  BUILDING_TYPE: ['Independent', 'Gated community', 'High-rise'],
  LOST_REASON: ['Budget too low', 'Bought elsewhere', 'Not responding'],
  WA_CATEGORY: ['Enquiry', 'Site visit', 'Follow-up', 'Booking'],
  WA_EVENT: ['Enquiry received', 'Site visit confirmation', 'Follow-up reminder', 'Booking confirmation'],
  UNIT_STATUS: ['On hold'], // AVAILABLE / BOOKED / SOLD already exist
} as const;
/** Locations belong to a branch. */
export const LOCATIONS = [
  { name: 'Anna Nagar', branch: 0 }, { name: 'Adyar', branch: 0 }, { name: 'Velachery', branch: 0 },
  { name: 'RS Puram', branch: 1 }, { name: 'Peelamedu', branch: 1 }, { name: 'Saravanampatti', branch: 1 },
] as const;

/** Units: name is the stable key. `status`: plan for the unit (booked ones are set by bookings, sold/hold by status changes). */
export const UNITS = [
  { name: 'Lakeview Villa A1', branch: 0, loc: 0, type: 0, building: 0, price: 18500000, bed: 4, bath: 4, area: 2850, status: 'BOOKED' },
  { name: 'Lakeview Villa A2', branch: 0, loc: 0, type: 0, building: 0, price: 17800000, bed: 4, bath: 3, area: 2700, status: 'BOOKED' },
  { name: 'Lakeview Villa A3', branch: 0, loc: 0, type: 0, building: 0, price: 19200000, bed: 4, bath: 4, area: 2950, status: 'SOLD' },
  { name: 'Marina Heights 5B', branch: 0, loc: 1, type: 1, building: 2, price: 9600000, bed: 3, bath: 2, area: 1650, status: 'BOOKED' },
  { name: 'Marina Heights 9A', branch: 0, loc: 1, type: 1, building: 2, price: 10400000, bed: 3, bath: 3, area: 1780, status: 'AVAILABLE' },
  { name: 'Marina Heights 12C', branch: 0, loc: 1, type: 1, building: 2, price: 8900000, bed: 2, bath: 2, area: 1320, status: 'SOLD' },
  { name: 'Velachery Greens Plot 14', branch: 0, loc: 2, type: 2, building: 0, price: 5200000, bed: 0, bath: 0, area: 2400, status: 'AVAILABLE' },
  { name: 'Velachery Greens Plot 22', branch: 0, loc: 2, type: 2, building: 0, price: 5600000, bed: 0, bath: 0, area: 2600, status: 'HOLD' },
  { name: 'Orchard Row House 3', branch: 0, loc: 0, type: 3, building: 1, price: 12600000, bed: 3, bath: 3, area: 1900, status: 'AVAILABLE' },
  { name: 'Orchard Row House 7', branch: 0, loc: 0, type: 3, building: 1, price: 12900000, bed: 3, bath: 3, area: 1950, status: 'AVAILABLE' },
  { name: 'Hillcrest Villa 1', branch: 1, loc: 3, type: 0, building: 1, price: 15400000, bed: 4, bath: 4, area: 2600, status: 'BOOKED' },
  { name: 'Hillcrest Villa 2', branch: 1, loc: 3, type: 0, building: 1, price: 15900000, bed: 4, bath: 3, area: 2650, status: 'AVAILABLE' },
  { name: 'Skyline Residency 4A', branch: 1, loc: 4, type: 1, building: 2, price: 7400000, bed: 2, bath: 2, area: 1180, status: 'SOLD' },
  { name: 'Skyline Residency 8D', branch: 1, loc: 4, type: 1, building: 2, price: 8100000, bed: 3, bath: 2, area: 1400, status: 'AVAILABLE' },
  { name: 'Saravanampatti Plot 5', branch: 1, loc: 5, type: 2, building: 0, price: 3800000, bed: 0, bath: 0, area: 1800, status: 'AVAILABLE' },
  { name: 'Saravanampatti Plot 9', branch: 1, loc: 5, type: 2, building: 0, price: 4100000, bed: 0, bath: 0, area: 2000, status: 'AVAILABLE' },
] as const;

export type Plan = 'NEW' | 'CONTACTED' | 'INTERESTED' | 'VISIT_UPCOMING' | 'VISIT_TODAY' | 'VISIT_OVERDUE' | 'VISIT_DONE' | 'VISIT_CANCELLED' | 'NEGOTIATION' | 'BOOKED' | 'BOOKED_RELEASED' | 'LOST';

const FIRST = ['Aarav', 'Ishaan', 'Kavya', 'Rahul', 'Sneha', 'Pranav', 'Divya', 'Sanjay', 'Priya', 'Harish', 'Tanvi', 'Manoj', 'Revathi', 'Gokul', 'Anjali', 'Naveen', 'Shalini', 'Dinesh', 'Pooja', 'Surya', 'Bhavana', 'Lokesh', 'Swathi', 'Ramesh', 'Janani', 'Vishal', 'Keerthi', 'Prakash', 'Deepa', 'Ashwin', 'Nandini', 'Sathish', 'Harini', 'Mukund', 'Oviya', 'Balaji', 'Sowmya', 'Yogesh'];
const LAST = ['Iyer', 'Nair', 'Reddy', 'Menon', 'Pillai', 'Gupta', 'Sharma', 'Rao', 'Naidu', 'Das', 'Kumar', 'Chandran'];

/** One scenario per enquiry. `sales` indexes salesOf(branch); `src`/`prop`/`loc` index the master lists above. */
const PLANS: Plan[] = [
  ...Array<Plan>(6).fill('NEW'), ...Array<Plan>(6).fill('CONTACTED'), ...Array<Plan>(4).fill('INTERESTED'),
  ...Array<Plan>(3).fill('VISIT_UPCOMING'), 'VISIT_TODAY', ...Array<Plan>(2).fill('VISIT_OVERDUE'), ...Array<Plan>(3).fill('VISIT_DONE'),
  'VISIT_CANCELLED', ...Array<Plan>(3).fill('NEGOTIATION'), ...Array<Plan>(4).fill('BOOKED'), 'BOOKED_RELEASED', ...Array<Plan>(3).fill('LOST'),
];
export const ENQUIRIES = PLANS.map((plan, i) => {
  const branch = (i % 5 < 3 ? 0 : 1) as 0 | 1;
  return {
    n: i + 1,
    plan,
    name: `${FIRST[i % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`,
    phone: `90000${String(10201 + i).padStart(5, '0')}`.slice(0, 10),
    branch,
    sales: i % 3,
    src: i % 6,
    type: i % 2,
    prop: i % 4,
    building: i % 3,
    /** 0-based index into that branch's locations */
    loc: (i * 2) % 3,
    /** days back to move the enquiry's creation date (spreads the data over ~two months) */
    ageDays: [0, 1, 2, 3, 5, 6, 8, 9, 12, 14, 17, 20, 24, 27, 31, 35, 38, 44, 50, 56][i % 20]!,
    notes: ['Looking for a home near good schools.', 'Wants a gated community with a clubhouse.', 'Investment buyer; prefers plots.', 'Needs a loan pre-approval first.', 'Relocating from Bengaluru next quarter.', 'Interested in ready-to-move units.'][i % 6]!,
  };
});

/** Clients (not converted from enquiries: the application has no conversion operation yet). */
export const CLIENTS = Array.from({ length: 14 }, (_, i) => ({
  name: `${FIRST[(i + 7) % FIRST.length]} ${LAST[(i * 3 + 2) % LAST.length]}`,
  phone: `90000${String(10301 + i).padStart(5, '0')}`.slice(0, 10),
  branch: (i % 2) as 0 | 1,
  sales: i % 3,
  email: `client${i + 1}@${DEMO_EMAIL_DOMAIN}`,
}));

/** Referrals: from clients, from employees, and from outside people. */
export const EXTERNAL_REFERRERS = [
  { name: 'Ravi Shankar', phone: '9000010401', branch: 0 as const },
  { name: 'Geetha Mohan', phone: '9000010402', branch: 0 as const },
  { name: 'Selvam Duraisamy', phone: '9000010403', branch: 1 as const },
];

export const TEMPLATES = [
  { name: 'Enquiry acknowledgement', category: 'Enquiry', event: 'Enquiry received', body: 'Hello {{client_name}}, thank you for your enquiry {{enquiry_no}}. Our team at {{branch_name}} will call you shortly.' },
  { name: 'Site visit confirmation', category: 'Site visit', event: 'Site visit confirmation', body: 'Hi {{client_name}}, your site visit to {{unit_name}} is confirmed for {{visit_datetime}}.' },
  { name: 'Follow-up reminder', category: 'Follow-up', event: 'Follow-up reminder', body: 'Hi {{client_name}}, this is a reminder from {{employee_name}} at {{branch_name}} about your property enquiry.' },
  { name: 'Booking confirmation', category: 'Booking', event: 'Booking confirmation', body: 'Dear {{client_name}}, your booking {{booking_no}} for {{unit_name}} is confirmed on {{booking_date}}. Congratulations!' },
] as const;
