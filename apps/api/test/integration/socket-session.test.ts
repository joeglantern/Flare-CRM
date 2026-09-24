/**
 * A live socket's periodic session check (docs/10 section 2.5).
 *
 * The check used to look the session up in a table that sessions are never written to, so it
 * failed every time and cut every browser off thirty seconds after it connected. Call popups sent
 * in the gaps were lost. The existing revocation test only tried a fresh handshake, so the
 * periodic path was never exercised; these run it for real, on a short interval.
 */
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestContext, type TestUser } from '../setup/test-app.js';

const RECHECK_MS = 250;

function connectAs(url: string, cookie: string): Socket {
  return connect(url, {
    transports: ['websocket'],
    extraHeaders: { cookie },
    reconnection: false,
    timeout: 5000,
  });
}

const connected = (s: Socket) =>
  new Promise<void>((resolve, reject) => {
    s.once('connect', () => {
      resolve();
    });
    s.once('connect_error', reject);
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('socket session re-check', () => {
  let ctx: TestContext;
  let url: string;
  let admin: TestUser;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await TestContext.create({ SOCKET_SESSION_RECHECK_MS: String(RECHECK_MS) });
    url = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    admin = await ctx.createUser({ role: 'admin' });
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await ctx.close();
  });

  it('keeps a socket whose session is still good through repeated checks', async () => {
    const agent = await ctx.createUser({ role: 'agent', extension: '1011' });
    const socket = connectAs(url, agent.cookie);
    sockets.push(socket);
    await connected(socket);
    let dropped = false;
    socket.on('disconnect', () => {
      dropped = true;
    });

    await sleep(RECHECK_MS * 6);

    expect(dropped).toBe(false);
    expect(socket.connected).toBe(true);
  });

  it('drops a socket at the next check once its user is deactivated', async () => {
    const victim = await ctx.createUser({ role: 'agent' });
    const socket = connectAs(url, victim.cookie);
    sockets.push(socket);
    await connected(socket);
    const gone = new Promise<string>((resolve) => {
      socket.once('disconnect', resolve);
    });

    await ctx.as(admin, { method: 'POST', url: `/api/v1/users/${victim.id}/deactivate` });

    await expect(
      Promise.race([gone, sleep(RECHECK_MS * 8).then(() => 'still connected')]),
    ).resolves.not.toBe('still connected');
  });
});
