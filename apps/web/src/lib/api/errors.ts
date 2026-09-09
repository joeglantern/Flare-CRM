/**
 * The API error envelope (docs/09 section 3): { error: { code, message, details?, requestId } }.
 * Every failed request in the app surfaces as an ApiError so callers can branch on `code`.
 */
export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    readonly details: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 422 payloads carry `details: [{ path, message }]`. */
  get fieldIssues(): FieldIssue[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is FieldIssue =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as FieldIssue).path === 'string' &&
        typeof (d as FieldIssue).message === 'string',
    );
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isTwoFactorRequired(): boolean {
    return this.code === 'TWO_FACTOR_REQUIRED';
  }

  get isForbidden(): boolean {
    return this.status === 403 && !this.isTwoFactorRequired && !this.isPlanProblem;
  }

  /** The plan does not include this (docs/20), as opposed to the role not allowing it. */
  get isFeatureNotInPlan(): boolean {
    return this.code === 'FEATURE_NOT_IN_PLAN';
  }

  get isPlanExpired(): boolean {
    return this.code === 'PLAN_EXPIRED';
  }

  /** A ceiling was reached; freeing something makes the same request work. */
  get isLimitReached(): boolean {
    return this.code === 'LIMIT_REACHED';
  }

  get isPlanProblem(): boolean {
    return this.isFeatureNotInPlan || this.isPlanExpired;
  }

  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 0;
  }
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    // non-JSON body (proxy error page, empty 502...)
  }
  const envelope =
    typeof body === 'object' && body !== null && 'error' in body
      ? (
          body as {
            error: Partial<{ code: string; message: string; details: unknown; requestId: string }>;
          }
        ).error
      : undefined;
  return new ApiError(
    response.status,
    envelope?.code ?? (response.status === 0 ? 'NETWORK' : `HTTP_${String(response.status)}`),
    envelope?.message ?? defaultMessage(response.status),
    envelope?.requestId ?? response.headers.get('x-request-id'),
    envelope?.details,
  );
}

export function networkError(cause: unknown): ApiError {
  return new ApiError(
    0,
    'NETWORK',
    'You appear to be offline. Check your connection and try again.',
    null,
    cause,
  );
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many requests. Please slow down.';
  if (status >= 500) return 'Something went wrong on the server. Please try again.';
  return 'Request failed.';
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** User-facing message for any thrown value. */
export function errorMessage(value: unknown): string {
  if (isApiError(value)) return value.message;
  if (value instanceof Error) return value.message;
  return 'Something went wrong.';
}
