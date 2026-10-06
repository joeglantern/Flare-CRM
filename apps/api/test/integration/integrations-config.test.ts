/**
 * An admin enters the email server and the PBX connection in Settings.
 *
 * What matters: nothing is saved until the server named has been tried, passwords and secrets
 * never come back out and are stored encrypted, a blank one keeps the one in use only where that
 * is safe, and a PBX change has to be confirmed because it reconnects everyone.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakePbx } from '../setup/fake-pbx.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

/** Just enough SMTP for nodemailer's verify(): a greeting, EHLO, and an optional login. */
function startFakeSmtp(login: {
  user: string;
  pass: string;
}): Promise<{ port: number; server: Server }> {
  const server = createServer((socket: Socket) => {
    socket.write('220 fake ESMTP\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const verb = line.split(' ')[0]?.toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-fake\r\n250 AUTH PLAIN\r\n');
        else if (verb === 'AUTH') {
          const given = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString('utf8');
          const [, user, pass] = given.split('\0');
          socket.write(user === login.user && pass === login.pass ? '235 ok\r\n' : '535 no\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ port: typeof address === 'object' && address ? address.port : 0, server });
    });
  });
}

describe('email and PBX settings entered by an admin', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let smtp: { port: number; server: Server };
  let pbx: FakePbx;
  const PASSWORD = 'mail-password-1234';
  const SECRET = 'pbx-client-secret-5678';

  let lane = 0;
  const call = (
    by: TestUser,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    ctx.as(by, {
      method,
      url,
      headers: { 'x-forwarded-for': `10.77.0.${String(++lane % 250)}` },
      ...(payload !== undefined ? { payload } : {}),
    });
  const smtpBody = (over: object = {}) => ({
    host: '127.0.0.1',
    port: smtp.port,
    security: 'none',
    username: 'crm',
    password: PASSWORD,
    from: 'Rani Africa CRM <crm@example.com>',
    ...over,
  });
  const pbxBody = (over: object = {}) => ({
    enabled: true,
    baseUrl: pbx.url,
    clientId: 'crm-client',
    clientSecret: SECRET,
    tls: 'public',
    confirmReconnect: true,
    ...over,
  });

  beforeAll(async () => {
    smtp = await startFakeSmtp({ user: 'crm', pass: PASSWORD });
    pbx = new FakePbx();
    await pbx.start();
    pbx.credentials = { username: 'crm-client', password: SECRET };
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    pbx.requests.length = 0;
    admin = await ctx.createUser({ role: 'admin' });
  });
  afterAll(async () => {
    // The next test file's app reads this table as it boots, before that file wipes the database.
    await ctx.app.db.integrationConfig.deleteMany();
    await ctx.close();
    await pbx.stop();
    smtp.server.close();
  });

  it('checks the mail server before saving, and never returns or stores the password in clear', async () => {
    const before = await call(admin, 'GET', '/api/v1/integrations/smtp');
    expect(before.json<Envelope<{ source: string }>>().data.source).toBe('server');

    const wrong = await call(
      admin,
      'PUT',
      '/api/v1/integrations/smtp',
      smtpBody({ password: 'nope-nope' }),
    );
    expect(wrong.statusCode).toBe(422);
    expect(wrong.body).toMatch(/refused the username or password/);
    expect(await ctx.app.db.integrationConfig.count()).toBe(0);

    const unreachable = await call(
      admin,
      'PUT',
      '/api/v1/integrations/smtp',
      smtpBody({ port: 1 }),
    );
    expect(unreachable.statusCode).toBe(503);
    expect(await ctx.app.db.integrationConfig.count()).toBe(0);

    const saved = await call(admin, 'PUT', '/api/v1/integrations/smtp', smtpBody());
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain(PASSWORD);
    expect(saved.json<Envelope<object>>().data).toMatchObject({
      source: 'admin',
      host: '127.0.0.1',
      username: 'crm',
      passwordSet: true,
    });
    const row = await ctx.app.db.integrationConfig.findUniqueOrThrow({ where: { key: 'smtp' } });
    expect(Buffer.from(row.dataEncrypted).toString('utf8')).not.toContain(PASSWORD);
    const audit = await ctx.app.db.auditLog.findFirstOrThrow({
      where: { action: 'integration.smtp_configured' },
    });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);

    // Same server and login with the password left blank: the one in use is kept.
    const kept = await call(admin, 'PUT', '/api/v1/integrations/smtp', smtpBody({ password: '' }));
    expect(kept.statusCode, kept.body).toBe(200);

    // Another login with no password is not allowed to borrow the old one.
    const borrowed = await call(
      admin,
      'PUT',
      '/api/v1/integrations/smtp',
      smtpBody({ username: 'someone-else', password: '' }),
    );
    expect(borrowed.statusCode).toBe(422);

    const test = await call(admin, 'POST', '/api/v1/integrations/smtp/test');
    expect(test.statusCode, test.body).toBe(200);
    expect(ctx.app.mailer.outbox.some((m) => m.to === admin.email)).toBe(true);

    const back = await call(admin, 'DELETE', '/api/v1/integrations/smtp');
    expect(back.json<Envelope<{ source: string }>>().data.source).toBe('server');
    expect(await ctx.app.db.integrationConfig.count()).toBe(0);
  });

  it('checks the PBX key before saving, hands the test token back, and keeps the secret out of sight', async () => {
    const unconfirmed = await call(
      admin,
      'PUT',
      '/api/v1/integrations/pbx',
      pbxBody({ confirmReconnect: undefined }),
    );
    expect(unconfirmed.statusCode).toBe(422);
    expect(unconfirmed.body).toMatch(/confirmReconnect/);

    const refused = await call(
      admin,
      'PUT',
      '/api/v1/integrations/pbx',
      pbxBody({ clientSecret: 'wrong-secret' }),
    );
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toMatch(/refused this client ID and secret/);
    expect(await ctx.app.db.integrationConfig.count()).toBe(0);

    const saved = await call(admin, 'PUT', '/api/v1/integrations/pbx', pbxBody());
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain(SECRET);
    expect(saved.json<Envelope<object>>().data).toMatchObject({
      source: 'admin',
      enabled: true,
      baseUrl: pbx.url,
      clientId: 'crm-client',
      secretSet: true,
      tls: 'public',
    });
    // The token minted to prove the key was handed straight back.
    expect(pbx.requests.some((r) => r.path === '/openapi/v1.0/del_token')).toBe(true);
    const row = await ctx.app.db.integrationConfig.findUniqueOrThrow({ where: { key: 'pbx' } });
    expect(Buffer.from(row.dataEncrypted).toString('utf8')).not.toContain(SECRET);

    // Same PBX and client: a blank secret keeps the one in use.
    const kept = await call(
      admin,
      'PUT',
      '/api/v1/integrations/pbx',
      pbxBody({ clientSecret: '' }),
    );
    expect(kept.statusCode, kept.body).toBe(200);
    // Another client ID cannot borrow it.
    const borrowed = await call(
      admin,
      'PUT',
      '/api/v1/integrations/pbx',
      pbxBody({ clientId: 'other-client', clientSecret: '' }),
    );
    expect(borrowed.statusCode).toBe(422);
  });

  it('asks for the fingerprint of a self-signed PBX', async () => {
    const res = await call(
      admin,
      'PUT',
      '/api/v1/integrations/pbx',
      pbxBody({ baseUrl: 'https://10.0.0.5:8088', tls: 'fingerprint', fingerprint: '' }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatch(/fingerprint/);
  });

  it('is for admins only', async () => {
    const manager = await ctx.createUser({ role: 'manager' });
    const agent = await ctx.createUser({ role: 'agent' });
    for (const who of [manager, agent]) {
      expect((await call(who, 'GET', '/api/v1/integrations/smtp')).statusCode).toBe(403);
      expect((await call(who, 'PUT', '/api/v1/integrations/pbx', pbxBody())).statusCode).toBe(403);
    }
  });
});
