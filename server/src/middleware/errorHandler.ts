import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCode } from '../lib/appError';
import { logger } from '../lib/logger';
import type { ApiFailure } from '../lib/respond';
import { formatZodIssues } from './validate';

function send(res: Response, req: Request, status: number, code: string, message: string, details?: unknown) {
  const body: ApiFailure = { error: { code, message, ...(details !== undefined ? { details } : {}) }, requestId: req.requestId };
  res.status(status).json(body);
}

interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: number | string;
  keyPattern?: Record<string, unknown>;
  name?: string;
}

/** Single place that turns any thrown value into the `{ error }` envelope. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.httpStatus >= 500) logger.error({ err, requestId: req.requestId }, err.message);
    return send(res, req, err.httpStatus, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    return send(res, req, 400, ErrorCode.VALIDATION_ERROR, 'Validation failed', formatZodIssues(err));
  }

  const e = (err ?? {}) as HttpLikeError;

  // Mongo duplicate key — report which fields collided, never the values.
  if (e.code === 11000) {
    return send(res, req, 409, ErrorCode.CONFLICT, 'A record with the same unique value already exists', {
      fields: Object.keys(e.keyPattern ?? {}),
    });
  }
  // Mongoose bad ObjectId etc.
  if (e.name === 'CastError') {
    return send(res, req, 400, ErrorCode.VALIDATION_ERROR, 'Invalid identifier or value');
  }
  // body-parser: malformed JSON / payload too large
  if (e.type === 'entity.parse.failed') {
    return send(res, req, 400, ErrorCode.VALIDATION_ERROR, 'Malformed JSON body');
  }
  if (e.type === 'entity.too.large') {
    return send(res, req, 413, ErrorCode.VALIDATION_ERROR, 'Request body too large');
  }

  logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  send(res, req, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error');
}
