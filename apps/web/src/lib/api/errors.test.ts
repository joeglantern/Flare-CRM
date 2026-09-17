import { describe, expect, it } from 'vitest';
import { ApiError, apiErrorFromResponse, errorMessage } from './errors';

describe('ApiError', () => {
  it('parses the API envelope', async () => {
    const res = new Response(
      JSON.stringify({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid',
          requestId: 'r1',
          details: [{ path: 'phones.0.number', message: 'Invalid phone' }, { nope: true }],
        },
      }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    );
    const err = await apiErrorFromResponse(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.requestId).toBe('r1');
    expect(err.fieldIssues).toEqual([{ path: 'phones.0.number', message: 'Invalid phone' }]);
    expect(err.isRetryable).toBe(false);
  });

  it('falls back sensibly for non-JSON bodies', async () => {
    const err = await apiErrorFromResponse(
      new Response('<html>Bad gateway</html>', { status: 502, headers: { 'x-request-id': 'abc' } }),
    );
    expect(err.code).toBe('HTTP_502');
    expect(err.requestId).toBe('abc');
    expect(err.isRetryable).toBe(true);
    expect(err.message).toMatch(/server/i);
  });

  it('flags auth conditions', async () => {
    const unauth = await apiErrorFromResponse(
      new Response(
        JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' } }),
        { status: 401 },
      ),
    );
    expect(unauth.isUnauthenticated).toBe(true);
    const twoFa = await apiErrorFromResponse(
      new Response(
        JSON.stringify({ error: { code: 'TWO_FACTOR_REQUIRED', message: 'x', requestId: 'r' } }),
        { status: 403 },
      ),
    );
    expect(twoFa.isTwoFactorRequired).toBe(true);
    expect(twoFa.isForbidden).toBe(false);
    expect(errorMessage(twoFa)).toBe('x');
    expect(errorMessage('weird')).toBe('Something went wrong.');
  });
});

/**
 * "Request validation failed" is all a 422 says for itself, and it is what a toast used to show.
 * Which field, and why, is in the details.
 */
describe('what a failure is reported as', () => {
  const at = (details: unknown) =>
    new ApiError(422, 'VALIDATION_FAILED', 'Request validation failed', null, details);

  it('says which field and why, rather than that something was wrong', () => {
    expect(errorMessage(at([{ path: 'key', message: 'snake_case, 2 to 40 characters' }]))).toBe(
      'key: snake_case, 2 to 40 characters',
    );
  });

  it('joins a few and counts the rest', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `f${String(i)}`, message: 'bad' }));
    expect(errorMessage(at(many))).toBe('f0: bad; f1: bad; f2: bad; and 2 more');
  });

  it('drops the path when the issue is about the body as a whole', () => {
    expect(errorMessage(at([{ path: '', message: 'options are required' }]))).toBe(
      'options are required',
    );
  });

  it('falls back to the message when there is nothing more specific', () => {
    expect(errorMessage(at([]))).toBe('Request validation failed');
    expect(errorMessage(at(undefined))).toBe('Request validation failed');
  });
});
