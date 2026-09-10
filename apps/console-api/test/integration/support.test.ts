/**
 * The door into a customer's system, tested as a door.
 *
 * A stand-in stack answers these commands, because what matters here is the console's half: that it
 * refuses to act when nothing is connected, that it audits the request before it is sent as well as
 * the answer, and that a stack refusing an action is reported rather than swallowed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { LINK_PROTOCOL, type SupportCommand } from '@crm/shared';
import { TestContext, type TestOwner } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

let ctx: TestContext;
let owner: TestOwner;
let port = 0;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const address = ctx.app.server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
});

beforeEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await ctx.reset();
  owner = await ctx.createOwner();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
});

afterAll(async () => {
  await ctx.close();
});

async function customerWithStack(): Promise<{
  customerId: string;
  stackId: string;
  secret: string;
}> {
  const created = await ctx.as(owner, {
    method: 'POST',
    url: '/api/v1/customers',
    payload: {
      name: 'Acme Ltd',
      slug: 'acme',
      contactName: 'Jane',
      contactEmail: 'jane@acme.example',
    },
  });
  const customerId = created.json<Envelope<{ id: string }>>().data.id;
  const stack = await ctx.as(owner, {
    method: 'POST',
    url: `/api/v1/customers/${customerId}/stacks`,
    payload: {},
  });
  const { stackId, secret } = stack.json<Envelope<{ stackId: string; secret: string }>>().data;
  return { customerId, stackId, secret };
}

/** A stack that answers commands the way a real one does, and records what it was asked. */
async function fakeStack(
  stackId: string,
  secret: string,
  answer: (command: SupportCommand) => Record<string, unknown>,
): Promise<{ socket: ClientSocket; asked: SupportCommand[] }> {
  const asked: SupportCommand[] = [];
  const socket = ioClient(`http://127.0.0.1:${String(port)}/link`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: { stackId, secret, protocol: LINK_PROTOCOL },
  });
  clients.push(socket);
  socket.on('command', (raw: SupportCommand) => {
    asked.push(raw);
    socket.emit('commandResult', { commandId: raw.commandId, action: raw.action, ...answer(raw) });
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('the stand-in stack never connected'));
    }, 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', reject);
  });
  // The console only sends to a stack it believes is connected.
  socket.emit('hello', {
    stackId,
    protocol: LINK_PROTOCOL,
    version: 'abc1234',
    domain: 'acme.flare.test',
    startedAt: new Date().toISOString(),
    entitlements: { issueId: null, issuedAt: null, keyId: null },
  });
  await expect
    .poll(
      async () => (await ctx.app.db.stack.findUniqueOrThrow({ where: { id: stackId } })).connected,
    )
    .toBe(true);
  return { socket, asked };
}

describe('support actions on a customer stack', () => {
  it('lists who can sign in there, and audits that we looked', async () => {
    const { customerId, stackId, secret } = await customerWithStack();
    const { asked } = await fakeStack(stackId, secret, () => ({
      ok: true,
      users: [
        {
          id: 'u1',
          name: 'Jane Doe',
          email: 'jane@acme.example',
          role: 'admin',
          isActive: true,
          twoFactorEnabled: true,
          lastSeenAt: null,
        },
      ],
    }));

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customerId}/support/list-users`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json<Envelope<{ users: { email: string }[] }>>().data;
    expect(data.users[0]?.email).toBe('jane@acme.example');
    expect(asked[0]?.action).toBe('list-users');
    expect(asked[0]?.requestedBy).toBe(owner.email);

    const actions = (await ctx.app.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('support.list-users');
    expect(actions).toContain('support.list-users.result');
  });

  it('asks the stack to reset somebody, naming who asked', async () => {
    const { customerId, stackId, secret } = await customerWithStack();
    const { asked } = await fakeStack(stackId, secret, () => ({
      ok: true,
      message: 'Jane Doe can set up an authenticator again.',
    }));

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customerId}/support/reset-two-factor`,
      payload: { email: 'jane@acme.example', reason: 'Lost her phone, confirmed by voice' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(asked[0]?.email).toBe('jane@acme.example');
    expect(asked[0]?.reason).toBe('Lost her phone, confirmed by voice');

    const row = await ctx.app.db.auditLog.findFirstOrThrow({
      where: { action: 'support.reset-two-factor' },
    });
    expect((row.after as { email?: string }).email).toBe('jane@acme.example');
    expect(JSON.stringify(row.after)).toContain('Lost her phone');
  });

  it('reports a refusal from the stack rather than claiming success', async () => {
    const { customerId, stackId, secret } = await customerWithStack();
    await fakeStack(stackId, secret, () => ({
      ok: false,
      message: 'Nobody here uses that email address',
    }));

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customerId}/support/reset-two-factor`,
      payload: { email: 'nobody@acme.example' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toContain('Nobody here');
  });

  it('will not act on a customer whose stack is not connected', async () => {
    const { customerId } = await customerWithStack();
    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customerId}/support/list-users`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toContain('not connected');
  });
});

describe('an owner locked out of the console', () => {
  it('can be let back in by the other owner, and loses their sessions doing it', async () => {
    const stuck = await ctx.createOwner({ email: 'stuck@example.com' });
    expect(
      (await ctx.app.db.user.findUniqueOrThrow({ where: { id: stuck.id } })).twoFactorEnabled,
    ).toBe(true);
    expect(await ctx.app.db.twoFactor.count({ where: { userId: stuck.id } })).toBe(1);
    // They are signed in right now, which is what makes the session revocation worth checking.
    expect((await ctx.as(stuck, { method: 'GET', url: '/api/v1/me' })).statusCode).toBe(200);

    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/owners/${stuck.id}/two-factor/reset`,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Envelope<{ twoFactorEnabled: boolean }>>().data.twoFactorEnabled).toBe(false);
    expect(await ctx.app.db.twoFactor.count({ where: { userId: stuck.id } })).toBe(0);
    // The cookie they held stops working, which is the observable half of revoking a session.
    expect((await ctx.as(stuck, { method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);

    const row = await ctx.app.db.auditLog.findFirstOrThrow({
      where: { action: 'owner.two_factor_reset' },
    });
    expect(row.entityId).toBe(stuck.id);
    expect(row.actorId).toBe(owner.id);
  });

  it('can be deactivated and brought back', async () => {
    const other = await ctx.createOwner({ email: 'other@example.com' });
    const off = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/owners/${other.id}/deactivate`,
    });
    expect(off.json<Envelope<{ isActive: boolean }>>().data.isActive).toBe(false);
    expect((await ctx.as(other, { method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);

    const on = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/owners/${other.id}/reactivate`,
    });
    expect(on.json<Envelope<{ isActive: boolean }>>().data.isActive).toBe(true);
    const actions = (await ctx.app.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain('owner.reactivate');
  });

  it('cannot switch off the account it is signed in as', async () => {
    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/owners/${owner.id}/deactivate`,
    });
    expect(res.statusCode).toBe(409);
  });
});
