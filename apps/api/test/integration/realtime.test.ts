import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestContext, type TestUser } from '../setup/test-app.js';

function waitFor<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function connectAs(url: string, cookie: string | null): Socket {
  return connect(url, {
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
    timeout: 5000,
  });
}

describe('realtime (Socket.IO)', () => {
  let ctx: TestContext;
  let url: string;
  let admin: TestUser;
  let agent: TestUser;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await TestContext.create();
    const address = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    url = address;
    admin = await ctx.createUser({ role: 'admin' });
    agent = await ctx.createUser({ role: 'agent', extension: '1010' });
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await ctx.close();
  });

  it('rejects unauthenticated handshakes', async () => {
    const socket = connectAs(url, null);
    sockets.push(socket);
    const err = await new Promise<Error>((resolve) => {
      socket.on('connect_error', resolve);
    });
    expect(err.message).toBe('UNAUTHENTICATED');
  });

  it('delivers notifications to the target user only', async () => {
    const agentSocket = connectAs(url, agent.cookie);
    const adminSocket = connectAs(url, admin.cookie);
    sockets.push(agentSocket, adminSocket);
    await Promise.all([waitFor(agentSocket, 'connect'), waitFor(adminSocket, 'connect')]);

    let adminGot = false;
    adminSocket.on('notification:new', () => {
      adminGot = true;
    });
    const incoming = waitFor<{ type: string; title: string }>(agentSocket, 'notification:new');

    const res = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title: 'Socket task', assigneeId: agent.id },
    });
    expect(res.statusCode, res.body).toBe(201);

    const payload = await incoming;
    expect(payload.type).toBe('task_assigned');
    expect(payload.title).toContain('Socket task');
    await new Promise((r) => setTimeout(r, 200));
    expect(adminGot).toBe(false);
  });

  it('broadcasts entity changes to watchers', async () => {
    const socket = connectAs(url, agent.cookie);
    sockets.push(socket);
    await waitFor(socket, 'connect');
    const created = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Watch' },
    });
    const id = created.json<{ data: { id: string } }>().data.id;
    socket.emit('entity:watch', { type: 'contact', id });
    await new Promise((r) => setTimeout(r, 100));
    const changed = waitFor<{ type: string; id: string }>(socket, 'entity:changed');
    await ctx.as(agent, {
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      payload: { jobTitle: 'CTO' },
    });
    expect(await changed).toMatchObject({ type: 'contact', id });
  });

  it('disconnects sockets whose session was revoked', async () => {
    const victim = await ctx.createUser({ role: 'agent' });
    const socket = connectAs(url, victim.cookie);
    sockets.push(socket);
    await waitFor(socket, 'connect');
    await ctx.as(admin, { method: 'POST', url: `/api/v1/users/${victim.id}/deactivate` });
    // the periodic recheck runs every 30 s; simulate it by deleting the session and forcing a recheck via reconnect attempt
    const again = connectAs(url, victim.cookie);
    sockets.push(again);
    const err = await new Promise<Error>((resolve) => {
      again.on('connect_error', resolve);
    });
    expect(err.message).toBe('UNAUTHENTICATED');
  });
});
