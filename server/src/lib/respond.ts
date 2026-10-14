import type { Response } from 'express';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: PageMeta;
}

export interface ApiFailure {
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

/** Success envelope: `{ data, meta? }`. */
export function ok<T>(res: Response, data: T, status = 200, meta?: PageMeta): void {
  const body: ApiSuccess<T> = meta ? { data, meta } : { data };
  res.status(status).json(body);
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}

export function paginated<T>(res: Response, rows: T[], meta: PageMeta): void {
  ok(res, rows, 200, meta);
}
