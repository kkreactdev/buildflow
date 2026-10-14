import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/appError';

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route not found: ${req.method} ${req.path}`));
}
