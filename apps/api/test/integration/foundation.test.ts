import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestContext } from '../setup/test-app.js';

describe('foundation: health, headers, errors', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('GET /health is public and minimal', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready reports dependency checks to internal callers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/ready', remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; checks: Record<string, { ok: boolean }> }>();
    expect(body.status).toBe('ready');
    expect(body.checks.database?.ok).toBe(true);
    expect(body.checks.valkey?.ok).toBe(true);
  });

  it('sets security headers and a request id', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('honours a valid incoming X-Request-Id and ignores an invalid one', async () => {
    const valid = '01923456-7890-7abc-8def-0123456789ab';
    const a = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': valid },
    });
    expect(a.headers['x-request-id']).toBe(valid);
    const b = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'not-a-uuid' },
    });
    expect(b.headers['x-request-id']).not.toBe('not-a-uuid');
  });

  it('returns the standard error shape for unknown routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: { code: string; requestId: string } }>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/users/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects cross-site state-changing requests', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    const res = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/teams',
      payload: { name: 'X' },
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed JSON with 400 and unknown body keys with 422', async () => {
    const admin = await ctx.createUser({ role: 'admin' });
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: { cookie: admin.cookie, 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(bad.statusCode).toBe(400);
    const strict = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/teams',
      payload: { name: 'Ok', evil: true },
    });
    expect(strict.statusCode).toBe(422);
    expect(strict.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });
});
