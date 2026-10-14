import { z } from 'zod';
import type { Types } from 'mongoose';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import type { PermissionKey } from '../../core/permissions/catalog';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex } from '../../lib/listQuery';
import { formatPhone, phoneSearchDigits } from '../../lib/phone';
import { Booking } from '../bookings/booking.model';
import { Client } from '../clients/client.model';
import { DocumentRecord } from '../documents/document.model';
import { DOCUMENT_ENTITIES, resolveEntity, type DocumentEntityType } from '../documents/document.entities';
import { Enquiry } from '../enquiries/enquiry.model';
import { Referral } from '../referrals/referral.model';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import { Unit } from '../units/unit.model';
import { listStages } from '../workflow/workflow.service';

type Id = Types.ObjectId;
type Row = Record<string, unknown> & { _id: Id };

export const MIN_QUERY = 2;
export const MAX_QUERY = 64;
export const MAX_LIMIT = 20;
const MIN_PHONE_DIGITS = 6; // short digit strings would match half the book; a number needs real digits to be searched
const SEARCH_TIME_LIMIT_MS = 3000;

interface Spec {
  type: string;
  label: string;
  needs: PermissionKey;
  model: Parameters<typeof scopedRepo>[0];
  /** Whether the model has soft-delete fields (bookings do not). */
  archivable: boolean;
  /** Record-number fields: matched as an ANCHORED prefix (index friendly), plus "42" for PREFIX-000042. */
  numbers: { field: string; prefix: string }[];
  /** Name-like fields: matched at the start of a word. */
  words: string[];
  /** Fields holding an E.164 phone. */
  phones: string[];
  select: string;
  item: (row: Row, ctx: { stages: Map<string, string> }) => { title: string; subtitle: string };
}

const s = (v: unknown) => String(v ?? '');
const phoneText = (v: unknown) => (v ? formatPhone(s(v)) : '');

const SPECS: Spec[] = [
  { type: 'client', label: 'Clients', needs: 'clients.view', model: Client, archivable: true, numbers: [{ field: 'clientNo', prefix: 'CL-' }], words: ['personName'], phones: ['phoneE164'], select: 'clientNo personName phoneE164', item: (r) => ({ title: s(r.personName), subtitle: `${s(r.clientNo)} · ${phoneText(r.phoneE164)}` }) },
  { type: 'enquiry', label: 'Enquiries', needs: 'enquiries.view', model: Enquiry, archivable: true, numbers: [{ field: 'enquiryNo', prefix: 'ENQ-' }], words: ['personName'], phones: ['phoneE164'], select: 'enquiryNo personName phoneE164 stageCode', item: (r, c) => ({ title: s(r.personName), subtitle: `${s(r.enquiryNo)} · ${c.stages.get(s(r.stageCode)) ?? s(r.stageCode)} · ${phoneText(r.phoneE164)}` }) },
  { type: 'unit', label: 'Units', needs: 'units.view', model: Unit, archivable: true, numbers: [{ field: 'unitCode', prefix: 'UNT-' }], words: ['name', 'city'], phones: [], select: 'unitCode name city', item: (r) => ({ title: s(r.name), subtitle: [s(r.unitCode), s(r.city)].filter(Boolean).join(' · ') }) },
  { type: 'booking', label: 'Bookings', needs: 'bookings.view', model: Booking, archivable: false, numbers: [{ field: 'bookingNo', prefix: 'BK-' }, { field: 'unitCode', prefix: 'UNT-' }, { field: 'enquiryNo', prefix: 'ENQ-' }], words: ['personName'], phones: ['phoneE164'], select: 'bookingNo unitCode personName phoneE164 status', item: (r) => ({ title: s(r.personName), subtitle: `${s(r.bookingNo)} · ${s(r.unitCode)} · ${s(r.status) === 'ACTIVE' ? 'Active' : 'Released'}` }) },
  { type: 'referral', label: 'Referrals', needs: 'referrals.view', model: Referral, archivable: true, numbers: [{ field: 'referralNo', prefix: 'REF-' }], words: ['personName'], phones: ['phoneE164'], select: 'referralNo personName phoneE164', item: (r) => ({ title: s(r.personName), subtitle: `${s(r.referralNo)} · ${phoneText(r.phoneE164)}` }) },
  { type: 'sitevisit', label: 'Site visits', needs: 'sitevisits.view', model: SiteVisit, archivable: true, numbers: [{ field: 'visitNo', prefix: 'SV-' }, { field: 'enquiryNo', prefix: 'ENQ-' }, { field: 'units.unitCode', prefix: 'UNT-' }], words: ['personName'], phones: ['phoneE164'], select: 'visitNo enquiryNo personName phoneE164', item: (r) => ({ title: s(r.personName), subtitle: `${s(r.visitNo)} · ${s(r.enquiryNo)}` }) },
  { type: 'document', label: 'Documents', needs: 'documents.view', model: DocumentRecord, archivable: true, numbers: [{ field: 'documentNo', prefix: 'DOC-' }, { field: 'entityNo', prefix: '' }], words: ['name', 'file.originalName'], phones: [], select: 'documentNo name entityType entityNo file.originalName', item: (r) => ({ title: s(r.name), subtitle: `${s(r.documentNo)} · ${DOCUMENT_ENTITIES[s(r.entityType) as DocumentEntityType]?.label ?? ''} ${s(r.entityNo)}` }) },
];
export const SEARCH_TYPES = SPECS.map((x) => x.type);

export const searchQuery = z
  .object({
    q: z.string({ required_error: 'Type something to search for' }).transform((v) => v.replace(/\s+/g, ' ').trim()).pipe(z.string().min(MIN_QUERY, `Type at least ${MIN_QUERY} characters`).max(MAX_QUERY, `At most ${MAX_QUERY} characters`)),
    types: z.string().transform((v) => v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)).pipe(z.array(z.enum(SEARCH_TYPES as [string, ...string[]])).min(1).max(SEARCH_TYPES.length)).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(5),
    page: z.coerce.number().int().min(1).max(50).default(1),
  })
  .strict();

/** The Mongo conditions one record type is searched with. Everything is escaped, anchored or word-start: never an unbounded pattern. */
function conditions(spec: Spec, q: string): Record<string, unknown>[] {
  const t = escapeRegex(q);
  const ors: Record<string, unknown>[] = [];
  for (const n of spec.numbers) {
    ors.push({ [n.field]: new RegExp(`^${t}`, 'i') }); // "ENQ-0004" or "CL"
    if (/^\d{1,9}$/.test(q) && n.prefix) ors.push({ [n.field]: new RegExp(`^${escapeRegex(n.prefix)}0*${q.replace(/^0+/, '') || '0'}$`) }); // "42" finds PREFIX-000042
  }
  for (const w of spec.words) ors.push({ [w]: new RegExp(`(^|[\\s.,_-])${t}`, 'i') });
  const digits = phoneSearchDigits(q);
  if (digits && digits.length >= MIN_PHONE_DIGITS) for (const p of spec.phones) ors.push({ [p]: new RegExp(escapeRegex(digits)) });
  return ors;
}

export async function search(principal: Principal, input: z.infer<typeof searchQuery>) {
  const allowed = SPECS.filter((sp) => hasPermission(principal, sp.needs));
  const wanted = input.types ? SPECS.filter((sp) => input.types!.includes(sp.type)) : allowed;
  const denied = wanted.filter((sp) => !allowed.includes(sp));
  if (denied.length) throw AppError.forbidden(`You do not have permission to search ${denied.map((d) => d.label.toLowerCase()).join(', ')}`);
  if (input.page > 1 && wanted.length !== 1) throw AppError.validation('Choose one record type to page through its results', [{ path: 'types', message: 'Pick a single type' }]);
  if (wanted.length === 0) return { query: input.q, results: [] as never[] };

  const stages = new Map((await listStages(true)).map((x) => [x.systemKey, x.label]));
  const results = await Promise.all(
    wanted.map(async (spec) => {
      // Each type is searched through its OWN scoped repository: branch, assignment and (for documents) record visibility apply before any text match.
      const repo = scopedRepo(spec.model, principal);
      const and: Record<string, unknown>[] = [{ $or: conditions(spec, input.q) }];
      if (spec.archivable) and.push({ isArchived: false });
      if (spec.type === 'document' && principal.dataScope === 'OWN') and.push({ createdBy: toObjectId(principal.userId) });
      const rows = await repo
        .find({ $and: and })
        .select(`${spec.select} entityId`)
        .sort({ _id: -1 })
        .skip((input.page - 1) * input.limit)
        .limit(input.limit + 1)
        .maxTimeMS(SEARCH_TIME_LIMIT_MS)
        .lean<Row[]>();
      let page = rows.slice(0, input.limit);
      if (spec.type === 'document' && principal.dataScope === 'OWN') {
        // A document is reachable only through a record the caller can still see (e.g. not after it was reassigned).
        const keep = await Promise.all(page.map((r) => resolveEntity(principal, s(r.entityType) as DocumentEntityType, s(r.entityId))));
        page = page.filter((_, i) => keep[i]);
      }
      return {
        type: spec.type,
        label: spec.label,
        hasMore: rows.length > input.limit,
        items: page.map((r) => ({ type: spec.type, id: r._id.toHexString(), ...spec.item(r, { stages }) })),
      };
    }),
  );
  return { query: input.q, results: results.filter((r) => r.items.length > 0 || input.types) };
}
