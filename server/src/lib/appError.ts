export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  TRANSACTIONS_UNSUPPORTED: 'TRANSACTIONS_UNSUPPORTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});

/**
 * Expected-failure error. Services throw `AppError`; anything else is a bug and
 * becomes a 500 via the global error handler. Module-specific codes (e.g.
 * STAGE_SKIP, BOOKING_CONFLICT) are plain strings passed in by the module.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(ErrorCode.VALIDATION_ERROR, 400, message, details);
  }
  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError(ErrorCode.UNAUTHENTICATED, 401, message);
  }
  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, 403, message);
  }
  static notFound(message = 'Resource not found'): AppError {
    return new AppError(ErrorCode.NOT_FOUND, 404, message);
  }
  static conflict(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(code, 409, message, details);
  }
}
