import { z } from 'zod';
import type { PageMeta } from './respond';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** Shared pagination + sort params for every list endpoint. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().optional(),
  search: z.string().trim().max(100).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface PageWindow {
  skip: number;
  limit: number;
}

export function toWindow(q: Pick<PageQuery, 'page' | 'limit'>): PageWindow {
  return { skip: (q.page - 1) * q.limit, limit: q.limit };
}

export function toMeta(q: Pick<PageQuery, 'page' | 'limit'>, total: number): PageMeta {
  return { page: q.page, limit: q.limit, total };
}

/**
 * Parses `?sort=-createdAt,name` against an explicit whitelist. Unknown fields
 * are ignored so callers can never sort on an unindexed/unsafe field.
 */
export function parseSort(
  raw: string | undefined,
  allowed: readonly string[],
  fallback: Record<string, 1 | -1> = { createdAt: -1 },
): Record<string, 1 | -1> {
  if (!raw) return fallback;
  const out: Record<string, 1 | -1> = {};
  for (const part of raw.split(',')) {
    const dir: 1 | -1 = part.startsWith('-') ? -1 : 1;
    const field = part.replace(/^[-+]/, '').trim();
    if (allowed.includes(field)) out[field] = dir;
  }
  return Object.keys(out).length ? out : fallback;
}

/** Escapes user text for safe use inside a Mongo `$regex`. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
