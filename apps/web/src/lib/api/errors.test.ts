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
