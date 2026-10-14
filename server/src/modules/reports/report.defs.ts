import type { Types } from 'mongoose';
import type { ZodTypeAny } from 'zod';
import type { PermissionKey } from '../../core/permissions/catalog';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { Booking } from '../bookings/booking.model';
import { buildFilter as bookingFilter, viewsOf as bookingRows, type BookingLean } from '../bookings/booking.service';
import { listBookingQuery } from '../bookings/booking.schema';
import { Enquiry } from '../enquiries/enquiry.model';
import { buildFilter as enquiryFilter, viewsOf as enquiryRows, type EnquiryLean } from '../enquiries/enquiry.service';
import { listEnquiryQuery } from '../enquiries/enquiry.schema';
import { FollowUp } from '../followups/followup.model';
import { buildFilter as followUpFilter, viewsOf as followUpRows, type FollowUpLean } from '../followups/followup.service';
import { listFollowUpQuery } from '../followups/followup.schema';
import { masterLabels } from '../masters/master.service';
import { Referral } from '../referrals/referral.model';
import { buildFilter as referralFilter, viewsOf as referralRows, type ReferralLean } from '../referrals/referral.service';
import { listReferralQuery } from '../referrals/referral.schema';
import { statusLabels } from '../sellers/seller.masters';
import { SellerProperty } from '../sellers/seller.model';
import { listPropertyQuery } from '../sellers/seller.schema';
import { buildPropertyFilter, propertyViews, type PropertyLean } from '../sellers/seller.service';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import { buildFilter as visitFilter, viewsOf as visitRows, type VisitLean } from '../sitevisits/sitevisit.service';
import { listVisitQuery } from '../sitevisits/sitevisit.schema';
import { Unit } from '../units/unit.model';
import { buildFilter as unitFilter, viewsOf as unitRows, type UnitLean } from '../units/unit.service';
import { listUnitQuery } from '../units/unit.schema';
import { listStages } from '../workflow/workflow.service';

type Id = Types.ObjectId;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Q = Row;

export interface Column {
  header: string;
  value: (row: Row) => unknown;
}

/**
 * A report is a THIN layer over a module's own list: the same scoped repository, the same filter builder, the same views. So
 * an on-screen report, its next page and its CSV export can never disagree about what the caller may see or which rows match.
 */
export interface ReportDef {
  key: string;
  label: string;
  description: string;
  /** The resource permission needed on top of reports.view / reports.export. */
  needs: PermissionKey;
  query: ZodTypeAny;
  model: Parameters<typeof scopedRepo>[0];
  filter: (q: Q) => Record<string, unknown>;
  includeArchived: (q: Q) => boolean;
  sortable: readonly string[];
  defaultSort: Record<string, 1 | -1>;
  rows: (principal: Principal, leans: never[]) => Promise<Row[]>;
  columns: Column[];
  /** Group the matching records by this field for the summary strip. */
  groupBy: string;
  groupLabels: (principal: Principal, keys: unknown[]) => Promise<Map<string, string>>;
  /** Short statement of what the numbers mean. */
  note?: string;
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d ? new Date(String(d)).toISOString() : '');
const phone = (v: unknown) => String(v ?? '').replace(/^\+/, ''); // no leading "+": spreadsheets would read it as a formula
const label = (m?: { label: string }) => m?.label ?? '';
const archived = (q: Q) => q.isArchived === 'true';

const masterGroup = async (principal: Principal, keys: unknown[]) => {
  const ids = keys.filter(Boolean).map((k) => String(k));
  const labels = ids.length ? await masterLabels(principal, ids) : new Map();
  return new Map<string, string>(ids.map((id) => [id, labels.get(id)?.label ?? 'Unknown']));
};
const plainGroup = async (_p: Principal, keys: unknown[]) => new Map<string, string>(keys.filter(Boolean).map((k) => [String(k), String(k).charAt(0) + String(k).slice(1).toLowerCase()]));

export const REPORTS: ReportDef[] = [
  {
    key: 'enquiries', label: 'Enquiries', description: 'Every enquiry with its source, property interest, stage and owner.', needs: 'enquiries.view',
    query: listEnquiryQuery, model: Enquiry, filter: (q) => enquiryFilter(q as never), includeArchived: archived, sortable: ['createdAt', 'enquiryNo', 'personName', 'stageChangedAt'], defaultSort: { createdAt: -1 },
    rows: (p, l) => enquiryRows(p, l as unknown as EnquiryLean[]),
    columns: [
      { header: 'Enquiry ID', value: (r) => r.enquiryNo }, { header: 'Created', value: (r) => iso(r.createdAt) }, { header: 'Name', value: (r) => r.name }, { header: 'Phone (with country code)', value: (r) => phone(r.phone) },
      { header: 'Stage', value: (r) => r.stage?.label }, { header: 'Source', value: (r) => label(r.source) }, { header: 'Type', value: (r) => label(r.type) }, { header: 'Property type', value: (r) => label(r.propertyType) },
      { header: 'Building type', value: (r) => label(r.buildingType) }, { header: 'Location', value: (r) => label(r.location) }, { header: 'Assigned to', value: (r) => r.assignedToName }, { header: 'Branch', value: (r) => r.branch?.name },
    ],
    groupBy: 'stageCode',
    groupLabels: async (_p, keys) => new Map((await listStages(true)).filter((s) => keys.includes(s.systemKey)).map((s) => [s.systemKey, s.label])),
    note: 'Date filters use the creation date. The summary shows the CURRENT stage of the matching enquiries.',
  },
  {
    key: 'followups', label: 'Follow-ups', description: 'Follow-ups by due date: upcoming, completed, cancelled and missed are separated by status.', needs: 'followups.view',
    query: listFollowUpQuery, model: FollowUp, filter: (q) => followUpFilter(q as never), includeArchived: archived, sortable: ['scheduledAt', 'createdAt', 'personName'], defaultSort: { scheduledAt: -1 },
    rows: (p, l) => followUpRows(p, l as unknown as FollowUpLean[]),
    columns: [
      { header: 'Due', value: (r) => iso(r.scheduledAt) }, { header: 'Person', value: (r) => r.name }, { header: 'Phone (with country code)', value: (r) => phone(r.phone) }, { header: 'Enquiry', value: (r) => r.enquiryNo }, { header: 'Client', value: (r) => r.clientNo },
      { header: 'Seller', value: (r) => r.sellerNo }, { header: 'Seller property', value: (r) => r.sellerPropertyNo },
      { header: 'Type', value: (r) => label(r.type) }, { header: 'Status', value: (r) => label(r.status) ?? r.statusKey }, { header: 'Assigned to', value: (r) => r.assignedToName }, { header: 'Times rescheduled', value: (r) => r.rescheduleCount },
      { header: 'Completed', value: (r) => iso(r.completedAt) }, { header: 'Outcome', value: (r) => r.outcome }, { header: 'Cancel reason', value: (r) => r.cancelReason },
    ],
    groupBy: 'statusKey', groupLabels: plainGroup,
    note: 'Date filters use the due date. "Missed" are open follow-ups flagged overdue; completed and cancelled are closed.',
  },
  {
    key: 'sitevisits', label: 'Site visits', description: 'Scheduled, completed and cancelled visits with their units.', needs: 'sitevisits.view',
    query: listVisitQuery, model: SiteVisit, filter: (q) => visitFilter(q as never), includeArchived: archived, sortable: ['scheduledAt', 'createdAt', 'visitNo', 'personName'], defaultSort: { scheduledAt: -1 },
    rows: (p, l) => visitRows(p, l as unknown as VisitLean[]),
    columns: [
      { header: 'Visit ID', value: (r) => r.visitNo }, { header: 'Scheduled', value: (r) => iso(r.scheduledAt) }, { header: 'Person', value: (r) => r.name }, { header: 'Enquiry', value: (r) => r.enquiryNo },
      { header: 'Units', value: (r) => (r.units as { unitCode: string }[]).map((u) => u.unitCode).join('; ') }, { header: 'Status', value: (r) => label(r.status) ?? r.statusKey }, { header: 'Assigned to', value: (r) => r.assignedToName },
      { header: 'Completed', value: (r) => iso(r.completedAt) }, { header: 'Feedback', value: (r) => r.feedback }, { header: 'Cancel reason', value: (r) => r.cancelReason },
    ],
    groupBy: 'statusKey', groupLabels: plainGroup,
    note: 'Date filters use the scheduled time.',
  },
  {
    key: 'units', label: 'Unit inventory', description: 'Units with their type, location, price, current status and salesperson.', needs: 'units.view',
    query: listUnitQuery, model: Unit, filter: (q) => unitFilter(q as never), includeArchived: archived, sortable: ['createdAt', 'unitCode', 'name', 'expectedPrice', 'builtUpArea', 'statusChangedAt'], defaultSort: { createdAt: -1 },
    rows: (p, l) => unitRows(p, l as unknown as UnitLean[]),
    columns: [
      { header: 'Unit ID', value: (r) => r.unitCode }, { header: 'Name', value: (r) => r.name }, { header: 'Property type', value: (r) => label(r.propertyType) }, { header: 'Building type', value: (r) => label(r.buildingType) },
      { header: 'Location', value: (r) => label(r.location) }, { header: 'Built-up area (sq ft)', value: (r) => r.builtUpArea }, { header: 'Expected price', value: (r) => r.expectedPrice }, { header: 'Status', value: (r) => label(r.status) ?? r.statusKey },
      { header: 'Salesperson', value: (r) => r.assignedToName }, { header: 'Branch', value: (r) => r.branch?.name },
    ],
    groupBy: 'statusId', groupLabels: masterGroup,
    note: 'The summary is the current status of the matching units.',
  },
  {
    key: 'bookings', label: 'Bookings', description: 'Bookings with their unit, person and salesperson. Active and released bookings are kept apart.', needs: 'bookings.view',
    query: listBookingQuery, model: Booking, filter: (q) => bookingFilter(q as never), includeArchived: () => false, sortable: ['bookingDate', 'createdAt', 'bookingNo', 'personName', 'unitCode'], defaultSort: { bookingDate: -1 },
    rows: (p, l) => bookingRows(p, l as unknown as BookingLean[]),
    columns: [
      { header: 'Booking ID', value: (r) => r.bookingNo }, { header: 'Booking date', value: (r) => iso(r.bookingDate) }, { header: 'Unit', value: (r) => r.unitCode }, { header: 'Person', value: (r) => r.name },
      { header: 'Phone (with country code)', value: (r) => phone(r.phone) }, { header: 'Enquiry', value: (r) => r.enquiryNo }, { header: 'Salesperson', value: (r) => r.salespersonName }, { header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Released') },
      { header: 'Released', value: (r) => iso(r.releasedAt) }, { header: 'Release reason', value: (r) => r.releaseReason },
    ],
    groupBy: 'status', groupLabels: plainGroup,
    note: 'Date filters use the booking date. Only ACTIVE bookings count as current bookings; released ones are history.',
  },
  {
    key: 'referrals', label: 'Referrals', description: 'Referrers with their type, source, assignee and the enquiries they brought.', needs: 'referrals.view',
    query: listReferralQuery, model: Referral, filter: (q) => referralFilter(q as never), includeArchived: archived, sortable: ['createdAt', 'referralNo', 'personName'], defaultSort: { createdAt: -1 },
    rows: async (p, leans) => {
      const rows = await referralRows(p, leans as unknown as ReferralLean[]);
      const ids = (leans as unknown as ReferralLean[]).flatMap((l) => l.enquiryIds ?? []);
      // Only the enquiries the caller may see are named; the rest are not listed (the count column is the referral's own fact).
      const found = ids.length && hasPermission(p, 'enquiries.view') ? await scopedRepo(Enquiry, p, { includeArchived: true }).find({ _id: { $in: ids } }).select('enquiryNo').lean<{ _id: Id; enquiryNo: string }[]>() : [];
      const no = new Map(found.map((e) => [e._id.toHexString(), e.enquiryNo]));
      const by = new Map((leans as unknown as ReferralLean[]).map((l) => [l._id.toHexString(), (l.enquiryIds ?? []).map((i) => no.get(i.toHexString())).filter(Boolean) as string[]]));
      return rows.map((r) => ({ ...r, enquiryNos: by.get(r.id) ?? [] }));
    },
    columns: [
      { header: 'Referral ID', value: (r) => r.referralNo }, { header: 'Created', value: (r) => iso(r.createdAt) }, { header: 'Name', value: (r) => r.name }, { header: 'Phone (with country code)', value: (r) => phone(r.phone) },
      { header: 'Type', value: (r) => label(r.type) }, { header: 'Source', value: (r) => r.sourceClientNo ?? (r.sourceUserId ? 'Employee' : 'External') }, { header: 'Assigned to', value: (r) => r.assignedToName },
      { header: 'Enquiries linked', value: (r) => r.enquiryCount }, { header: 'Enquiry IDs', value: (r) => (r.enquiryNos as string[]).join('; ') }, { header: 'Branch', value: (r) => r.branch?.name },
    ],
    groupBy: 'typeId', groupLabels: masterGroup,
    note: 'Date filters use the creation date. Referrals have no status, commission or payout in this release.',
  },
  {
    key: 'seller-properties', label: 'Seller properties', description: 'Properties offered by sellers: where each is in the purchase pipeline, what was paid, and whether its unit is released to buyers.', needs: 'sellers.view',
    query: listPropertyQuery, model: SellerProperty, filter: (q) => buildPropertyFilter(q as never), includeArchived: archived, sortable: ['sellerPropertyNo', 'name', 'askingPrice', 'statusChangedAt', 'createdAt'], defaultSort: { createdAt: -1 },
    rows: (p, l) => propertyViews(p, l as unknown as PropertyLean[]),
    columns: [
      { header: 'Property ID', value: (r) => r.sellerPropertyNo }, { header: 'Registered', value: (r) => iso(r.createdAt) }, { header: 'Property', value: (r) => r.name },
      { header: 'Seller ID', value: (r) => r.sellerNo }, { header: 'Seller', value: (r) => r.sellerName }, { header: 'Status', value: (r) => label(r.status) || r.statusKey }, { header: 'Status since', value: (r) => iso(r.statusChangedAt) },
      { header: 'City', value: (r) => r.city }, { header: 'Asking price', value: (r) => r.askingPrice }, { header: 'Purchase price', value: (r) => r.purchasePrice }, { header: 'Purchase date', value: (r) => iso(r.purchaseDate) },
      { header: 'Purchase reference', value: (r) => r.purchaseReference }, { header: 'Unit', value: (r) => r.unitCode }, { header: 'Released to buyers', value: (r) => (r.eligibleForBuyers ? 'Yes' : 'No') },
      { header: 'Assigned to', value: (r) => r.assignedToName }, { header: 'Branch', value: (r) => r.branch?.name },
    ],
    groupBy: 'statusKey', groupLabels: async (_p, keys) => { const m = await statusLabels('PROPERTY_STATUS'); return new Map(keys.filter(Boolean).map((k) => [String(k), m.get(String(k))?.label ?? String(k)])); },
    note: 'Date filters use the registration date. "Released to buyers" means the property is Ready to Sell and its unit can be offered.',
  },
];

export const reportByKey = (key: string): ReportDef | undefined => REPORTS.find((r) => r.key === key);
