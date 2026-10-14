import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from '../lib/requestContext';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

/** Assigns a server-generated request id (never trusts a client-supplied one) and opens the async context. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  requestContext.run({ requestId }, next);
}
