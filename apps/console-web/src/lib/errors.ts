/**
 * The console API answers failures with the same envelope the CRM does (docs/09 §3):
 * `{ error: { code, message, details?, requestId } }`. Every failed request becomes an ApiError so
 * a caller can branch on the code rather than on a string.
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

  /** Signed in, but two-factor is not set up yet: the console lets nothing else through. */
  get isTwoFactorRequired(): boolean {
    return this.code === 'TWO_FACTOR_REQUIRED';
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 0;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    // a proxy error page, or an empty 502
  }
  const envelope =
    typeof body === 'object' && body !== null && 'error' in body
      ? (
          body as {
            error: Partial<
              FieldIssue & { code: string; message: string; details: unknown; requestId: string }
            >;
          }
        ).error
      : {};
  return new ApiError(
    response.status,
    envelope.code ?? (response.status === 0 ? 'NETWORK' : 'HTTP_ERROR'),
    envelope.message ?? `The request failed (${String(response.status)}).`,
    envelope.requestId ?? response.headers.get('x-request-id'),
    envelope.details,
  );
}

export function networkError(cause: unknown): ApiError {
  return new ApiError(
    0,
    'NETWORK',
    'The console could not be reached. Check your connection and try again.',
    null,
    cause,
  );
}

/** What to show a person when a request fails. Field issues are handled by the form itself. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return 'Something went wrong.';
}
