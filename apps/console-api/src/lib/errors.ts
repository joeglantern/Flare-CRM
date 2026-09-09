/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
/**
 * Application errors (docs/09 §3, docs/14 §1). Services throw these; the error handler maps them.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'TWO_FACTOR_REQUIRED'
  | 'DO_NOT_CALL'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'STALE_VERSION'
  | 'TEMPLATE_REQUIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'PBX_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'FEATURE_NOT_IN_PLAN'
  | 'PLAN_EXPIRED'
  | 'LIMIT_REACHED'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super('BAD_REQUEST', 400, message, details);
  }
}
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', 401, message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super('FORBIDDEN', 403, message, details);
  }
}
export class TwoFactorRequiredError extends AppError {
  constructor() {
    super('TWO_FACTOR_REQUIRED', 403, 'Two-factor authentication must be enabled for this role');
  }
}
export class NotFoundError extends AppError {
  constructor(entity = 'Resource') {
    super('NOT_FOUND', 404, `${entity} not found`);
  }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('CONFLICT', 409, message, details);
  }
}
export class DuplicateError extends AppError {
  constructor(message: string, matches: unknown) {
    super('DUPLICATE', 409, message, { matches });
  }
}
export class StaleVersionError extends AppError {
  constructor() {
    super('STALE_VERSION', 409, 'The record was modified by someone else; reload and retry');
  }
}
export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Request validation failed') {
    super('VALIDATION_FAILED', 422, message, details);
  }
}
export class RateLimitedError extends AppError {
  constructor() {
    super('RATE_LIMITED', 429, 'Too many requests');
  }
}
export class PbxUnavailableError extends AppError {
  constructor(message = 'PBX is not reachable right now', options?: { cause?: unknown }) {
    super('PBX_UNAVAILABLE', 503, message, undefined, options);
  }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super('SERVICE_UNAVAILABLE', 503, message);
  }
}

/**
 * Plan errors (docs/20). A feature that is not in the customer's plan is a 403 like any other
 * refusal of an identity's request. A limit is a 409: freeing a seat makes the identical request
 * succeed, exactly like DUPLICATE or STALE_VERSION, and the form can show it inline.
 */
export class FeatureNotInPlanError extends AppError {
  constructor(feature: string, label: string) {
    super('FEATURE_NOT_IN_PLAN', 403, `${label} is not included in your plan`, { feature });
  }
}
export class PlanExpiredError extends AppError {
  constructor(expiredAt: string) {
    super('PLAN_EXPIRED', 403, 'Your plan has expired; changes are refused until it is renewed', {
      expiredAt,
    });
  }
}
export class LimitReachedError extends AppError {
  constructor(limit: string, label: string, used: number, max: number) {
    super('LIMIT_REACHED', 409, `${label} limit reached (${String(used)} of ${String(max)})`, {
      limit,
      used,
      max,
    });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
