import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from '../lib/appError';


export interface Validated<B = unknown, P = unknown, Q = unknown> {
  body: B;
  params: P;
  query: Q;
}

declare module 'express-serve-static-core' {
  interface Request {
    validated?: Validated;
  }
}

export function formatZodIssues(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/**
 * Runs zod before the controller. Parsed (coerced, defaulted, stripped) input
 * is placed on `req.validated`; controllers must read from there, not from
 * `req.body`/`req.query`.
 */
export function validate<B extends ZodTypeAny, P extends ZodTypeAny, Q extends ZodTypeAny>(schemas: {
  body?: B;
  params?: P;
  query?: Q;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.validated = {
        body: schemas.body ? schemas.body.parse(req.body) : undefined,
        params: schemas.params ? schemas.params.parse(req.params) : undefined,
        query: schemas.query ? schemas.query.parse(req.query) : undefined,
      };
      next();
    } catch (err) {
      if (err instanceof ZodError) return next(AppError.validation('Validation failed', formatZodIssues(err)));
      next(err);
    }
  };
}

/** Typed accessor for validated input inside a controller. */
export function validated<B extends ZodTypeAny = ZodTypeAny, P extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny>(
  req: Request,
): Validated<z.infer<B>, z.infer<P>, z.infer<Q>> {
  if (!req.validated) throw new Error('validated() called on a route without validate()');
  return req.validated as Validated<z.infer<B>, z.infer<P>, z.infer<Q>>;
}

