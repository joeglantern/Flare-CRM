/**
 * Getting back in after somebody's second factor is reset.
 *
 * A reset is only half the job. What matters to the person holding a new phone is what happens at
 * the next sign-in: they must be offered an authenticator to set up, not a box asking for a code
 * that no longer exists anywhere. This walks that path with a real TOTP secret rather than by
 * flipping the flag, because the flag is not what the sign-in reads.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestUser } from '../setup/test-app.js';

let ctx: TestContext;
let admin: TestUser;

beforeAll(async () => {
  ctx = await TestContext.create();
});

beforeEach(async () => {
  await ctx.reset();
  admin = await ctx.createUser({ role: 'admin' });
  await ctx.app.settings.set(
    'security',
    { require2FAForPrivileged: true, require2FAForAll: false, sessionIdleMinutes: 60 },
    null,
  );
  // The administrator doing the reset lives under the same rule as everybody else.
  await enrol(admin);
});

afterAll(async () => {
  await ctx.close();
});

/** RFC 6238, six digits, thirty second step: what an authenticator app shows. */
function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac('sha1', Buffer.from(Uint8Array.from(bytes)))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

function cookiesFrom(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return list.map((c) => c.split(';')[0] ?? '').join('; ');
}

async function signIn(email: string, password: string) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'application/json', origin: ctx.env.APP_URL },
    payload: { email, password },
  });
}

function mergeCookies(existing: string, header: string | string[] | undefined): string {
  const jar = new Map<string, string>();
  for (const part of `${existing}; ${cookiesFrom(header)}`.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Enrols the way a person does: password, then a code from the secret they were shown. Verifying
 * hands back a fresh cookie, which is why it is merged in rather than discarded.
 */
async function enrol(user: TestUser): Promise<string> {
  const enabled = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/two-factor/enable',
    headers: { 'content-type': 'application/json', cookie: user.cookie, origin: ctx.env.APP_URL },
    payload: { password: user.password },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  const secret = new URL(enabled.json<{ totpURI: string }>().totpURI).searchParams.get('secret');
  expect(secret).toBeTruthy();
  const verified = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/two-factor/verify-totp',
    headers: { 'content-type': 'application/json', cookie: user.cookie, origin: ctx.env.APP_URL },
    payload: { code: totp(secret ?? '') },
  });
  expect(verified.statusCode, verified.body).toBe(200);
  user.cookie = mergeCookies(user.cookie, verified.headers['set-cookie']);
  return secret ?? '';
}

describe('after an administrator resets somebody’s second factor', () => {
  it('their next sign-in offers enrolment, not a code box', async () => {
    const stuck = await ctx.createUser({ role: 'manager' });
    await enrol(stuck);
    expect(
      (await ctx.app.db.user.findUniqueOrThrow({ where: { id: stuck.id } })).twoFactorEnabled,
    ).toBe(true);

    const reset = await ctx.as(admin, {
      method: 'POST',
      url: `/api/v1/users/${stuck.id}/two-factor/reset`,
    });
    expect(reset.statusCode, reset.body).toBe(200);

    const again = await signIn(stuck.email, stuck.password);
    expect(again.statusCode, again.body).toBe(200);
    const body = again.json<{ twoFactorRedirect?: boolean }>();
    // This is the whole bug: a sign-in that still asks for a second factor sends the browser to
    // the code screen, and there is no code to give.
    expect(body.twoFactorRedirect ?? false).toBe(false);

    // They are signed in, and their own profile tells the app to send them to enrolment.
    const cookie = cookiesFrom(again.headers['set-cookie']);
    expect(cookie).not.toBe('');
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { cookie },
    });
    expect(me.statusCode, me.body).toBe(200);
    const profile = me.json<{ data: { twoFactorEnabled: boolean; twoFactorRequired: boolean } }>()
      .data;
    expect(profile.twoFactorEnabled).toBe(false);
    expect(profile.twoFactorRequired).toBe(true);
  });

  it('lets them set up an authenticator again with the same password', async () => {
    const stuck = await ctx.createUser({ role: 'manager' });
    await enrol(stuck);
    await ctx.as(admin, { method: 'POST', url: `/api/v1/users/${stuck.id}/two-factor/reset` });

    const again = await signIn(stuck.email, stuck.password);
    const cookie = cookiesFrom(again.headers['set-cookie']);
    const enabled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/enable',
      headers: { 'content-type': 'application/json', cookie, origin: ctx.env.APP_URL },
      payload: { password: stuck.password },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const uri = enabled.json<{ totpURI: string }>().totpURI;
    const secret = new URL(uri).searchParams.get('secret') ?? '';
    // A new secret, not the one they lost with the phone.
    expect(secret).not.toBe('');
    const verified = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { 'content-type': 'application/json', cookie, origin: ctx.env.APP_URL },
      payload: { code: totp(secret) },
    });
    expect(verified.statusCode, verified.body).toBe(200);
    expect(
      (await ctx.app.db.user.findUniqueOrThrow({ where: { id: stuck.id } })).twoFactorEnabled,
    ).toBe(true);
  });

  it('tells them it happened, so a dead authenticator is not their first clue', async () => {
    const stuck = await ctx.createUser({ role: 'manager', name: 'Amina Yusuf' });
    await enrol(stuck);
    ctx.app.mailer.outbox.length = 0;

    await ctx.as(admin, { method: 'POST', url: `/api/v1/users/${stuck.id}/two-factor/reset` });

    const notice = ctx.app.mailer.outbox.find((m) => m.to === stuck.email);
    expect(notice, 'the person it happened to was not told').toBeDefined();
    expect(notice?.subject).toContain('two-factor');
    // Who did it, in a name they will recognise, and what to do next.
    expect(notice?.text).toContain('Test admin');
    expect(notice?.text).toContain('/sign-in');
    expect(notice?.text).toContain('no longer work');
  });

  it('ends the sessions they had, so an old tab cannot carry on', async () => {
    const stuck = await ctx.createUser({ role: 'manager' });
    await enrol(stuck);
    await ctx.as(admin, { method: 'POST', url: `/api/v1/users/${stuck.id}/two-factor/reset` });
    const old = await ctx.as(stuck, { method: 'GET', url: '/api/v1/users/me' });
    expect(old.statusCode).toBe(401);
  });
});
