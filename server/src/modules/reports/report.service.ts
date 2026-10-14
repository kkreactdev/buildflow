import type { Types } from 'mongoose';
import { ZodError } from 'zod';
import { getEnv } from '../../config/env';
import { recordAudit } from '../../core/audit/audit.service';
import { assertPermission, hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { formatZodIssues } from '../../middleware/validate';
import { dashboardQuery } from '../dashboard/dashboard.range';
import { funnel } from '../dashboard/dashboard.service';
import { csvCell } from '../enquiries/enquiry.service';
import { REPORTS, reportByKey, type ReportDef } from './report.defs';

type Id = Types.ObjectId;
const BATCH = 500;
const FUNNEL = { key: 'funnel', label: 'Conversion funnel', description: 'How many enquiries are in each workflow stage now, and how many entered each stage in the period.', needs: 'enquiries.view' as const };

function parse<T>(schema: { parse: (v: unknown) => T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) throw AppError.validation('Validation failed', formatZodIssues(err));
    throw err;
  }
}

/** The reports this user may run: they need reports.view AND the view permission of what the report lists. */
export function listReports(principal: Principal) {
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(principal, k);
  if (!can('reports.view')) return [];
  return [...REPORTS, FUNNEL]
    .filter((r) => can(r.needs))
    .map((r) => ({ key: r.key, label: r.label, description: r.description, canExport: can('reports.export'), note: 'note' in r ? r.note : undefined }));
}

function assertCanRun(principal: Principal, needs: Parameters<typeof assertPermission>[1], exporting: boolean) {
  assertPermission(principal, exporting ? 'reports.export' : 'reports.view');
  assertPermission(principal, needs); // being allowed to run reports never opens a resource you cannot view
}

async function groupSummary(principal: Principal, def: ReportDef, q: Record<string, unknown>, filter: Record<string, unknown>) {
  const repo = scopedRepo(def.model, principal, { requestedBranchId: q.branchId as string | undefined, includeArchived: def.includeArchived(q) });
  const rows = await repo.aggregate<{ _id: unknown; n: number }>([{ $match: filter }, { $group: { _id: `$${def.groupBy}`, n: { $sum: 1 } } }]);
  const labels = await def.groupLabels(principal, rows.map((x) => (x._id as { toHexString?: () => string })?.toHexString?.() ?? x._id));
  return rows
    .map((x) => {
      const key = String((x._id as { toHexString?: () => string })?.toHexString?.() ?? x._id ?? '');
      return { key, label: labels.get(key) ?? (key || 'None'), count: x.n };
    })
    .sort((a, b) => b.count - a.count);
}

export async function runReport(principal: Principal, key: string, raw: unknown) {
  if (key === FUNNEL.key) {
    assertCanRun(principal, FUNNEL.needs, false);
    const data = await funnel(principal, parse(dashboardQuery, raw));
    return { key, label: FUNNEL.label, kind: 'funnel' as const, funnel: data, rows: data.stages, meta: { page: 1, limit: data.stages.length, total: data.stages.length } };
  }
  const def = reportByKey(key);
  if (!def) throw AppError.notFound('Report not found');
  assertCanRun(principal, def.needs, false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = parse(def.query as any, raw) as Record<string, any>;
  const filter = def.filter(q);
  const repo = scopedRepo(def.model, principal, { requestedBranchId: q.branchId, includeArchived: def.includeArchived(q) });
  const { skip, limit } = toWindow(q as { page: number; limit: number });
  const sort = parseSort(q.sort, def.sortable, def.defaultSort);
  const [leans, total, groups] = await Promise.all([
    repo.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean(),
    repo.countDocuments(filter),
    groupSummary(principal, def, q, filter),
  ]);
  const rows = await def.rows(principal, leans as never[]);
  return { key, label: def.label, kind: 'list' as const, note: def.note, columns: def.columns.map((c) => c.header), rows, cells: rows.map((r) => def.columns.map((c) => c.value(r) ?? '')), summary: { total, groups }, meta: toMeta(q as { page: number; limit: number }, total) };
}

/**
 * Streams a report as CSV through the SAME scoped repository and filters as the on-screen report. It refuses (413) when the result
 * is larger than EXPORT_MAX_ROWS before sending a byte, neutralises spreadsheet formulas, and records the export in the audit log.
 */
export async function exportReport(principal: Principal, key: string, raw: unknown, write: (chunk: string) => void): Promise<number> {
  const max = getEnv().EXPORT_MAX_ROWS;
  let written = 0;
  let filters: Record<string, unknown>;
  if (key === FUNNEL.key) {
    assertCanRun(principal, FUNNEL.needs, true);
    const data = await funnel(principal, parse(dashboardQuery, raw));
    write(`\uFEFF${['Stage', 'Kind', 'In stage now', 'Entered during the period'].map(csvCell).join(',')}\r\n`);
    for (const s of data.stages) {
      write(`${[s.label, s.kind === 'LOST' ? 'Lost' : 'Pipeline', s.current, s.entered].map(csvCell).join(',')}\r\n`);
      written++;
    }
    filters = { from: data.range.from, to: data.range.to };
  } else {
    const def = reportByKey(key);
    if (!def) throw AppError.notFound('Report not found');
    assertCanRun(principal, def.needs, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = parse(def.query as any, raw) as Record<string, any>;
    const filter = def.filter(q);
    const repo = scopedRepo(def.model, principal, { requestedBranchId: q.branchId, includeArchived: def.includeArchived(q) });
    const total = await repo.countDocuments(filter);
    if (total > max) throw new AppError('EXPORT_TOO_LARGE', 413, `This export has ${total} rows (limit ${max}). Narrow the filters and try again.`);
    write(`\uFEFF${def.columns.map((c) => csvCell(c.header)).join(',')}\r\n`);
    let last: Id | undefined;
    for (;;) {
      const page = await repo.find(last ? { $and: [filter, { _id: { $lt: last } }] } : filter).sort({ _id: -1 }).limit(BATCH).lean<{ _id: Id }[]>();
      if (page.length === 0) break;
      for (const row of await def.rows(principal, page as never[])) {
        write(`${def.columns.map((c) => csvCell(c.value(row))).join(',')}\r\n`);
        written++;
      }
      last = page[page.length - 1]!._id;
    }
    filters = { ...q, search: q.search ? '[set]' : undefined, page: undefined, limit: undefined, sort: undefined };
  }
  await recordAudit({ entityType: 'export', entityId: principal.userId, action: `report:${key}`, after: { rows: written, filters: JSON.stringify(filters) }, userId: principal.userId, branchId: principal.branchIds[0] }, { bestEffort: true });
  return written;
}
