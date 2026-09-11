/**
 * The link every customer stack dials home on (docs/21).
 *
 * Stacks connect outward to this namespace and stay connected; the console never reaches into a
 * customer's network. A stack proves itself with its id and secret, then says hello, sends a
 * heartbeat every half minute, and acknowledges each entitlements document it is handed.
 *
 * Owners watch the same events from the default namespace, so the fleet screen is live rather
 * than polled.
 */
import {
  consoleServerEvents,
  stackToConsoleEvents,
  LINK_PROTOCOL,
  type ConsoleServerEventName,
  type ConsoleServerPayload,
  type SupportCommand,
} from '@crm/shared';
import { newId } from '../lib/ids.js';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

const OWNERS_ROOM = 'owners';
/** A stack that has not been heard from in this long is treated as gone. */
const STALE_AFTER_MS = 90_000;
const SWEEP_EVERY_MS = 30_000;
const EVENTS_PER_SECOND = 5;
/**
 * How often a heartbeat is kept as a sample. Beats arrive every thirty seconds; a row every five
 * minutes is 288 a day per stack, which is enough to draw an honest line and little enough to keep
 * for a month. The gate is one Valkey write, so a beat never costs a query to find out.
 */
const SAMPLE_EVERY_MS = 5 * 60_000;

export interface ConsoleLink {
  /** Hands each issued document to its stack, if that stack is connected. */
  deliver: (issues: { issueId: string; stackId: string; envelope: unknown }[]) => Promise<void>;
  announce: (stackIds: string[], message: { message: string; level: string }) => number;
  disconnect: (stackId: string) => void;
  connectedStacks: () => string[];
  /** Asks a connected stack to do one supported thing and waits for its answer. */
  command: (stackId: string, command: SupportCommand, timeoutMs: number) => Promise<unknown>;
  /** Asks for a heartbeat now rather than at the next tick. */
  ping: (stackId: string) => boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export default fp(
  function linkPlugin(app: FastifyInstance) {
    const io = new Server(app.server, {
      path: '/socket.io',
      transports: ['websocket'],
      serveClient: false,
      cors: { origin: [app.config.CONSOLE_URL, ...app.config.DEV_ORIGINS], credentials: true },
      maxHttpBufferSize: 256 * 1024,
      pingInterval: 25_000,
      pingTimeout: 20_000,
    });

    const pub = app.valkey.duplicate();
    const sub = app.valkey.duplicate();
    io.adapter(createAdapter(pub, sub));

    const owners = io.of('/');
    const link = io.of('/link');
    /** stackId -> the socket currently speaking for it, in this process. */
    const live = new Map<string, Socket>();
    /** commandId -> whoever is waiting for that stack to answer. */
    const waiting = new Map<string, (answer: unknown) => void>();

    const toOwners = <E extends ConsoleServerEventName>(
      event: E,
      payload: ConsoleServerPayload<E>,
    ) => {
      const parsed = consoleServerEvents[event].safeParse(payload);
      if (!parsed.success) {
        app.log.error({ event, issues: parsed.error.issues }, 'refusing to emit a bad payload');
        return;
      }
      owners.to(OWNERS_ROOM).emit(event, parsed.data);
    };

    // ── owners: a signed-in browser watching the fleet ──────────────────────────────────
    owners.use((socket, next) => {
      void (async () => {
        const session = await app.getSession(socket.handshake.headers);
        if (!session) {
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        const user = await app.db.user.findUnique({
          where: { id: session.user.id },
          select: { isActive: true, twoFactorEnabled: true },
        });
        // Same bar as every other route here: no second factor, no console.
        if (!user?.isActive || user.twoFactorEnabled !== true) {
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        next();
      })().catch(() => {
        next(new Error('UNAUTHENTICATED'));
      });
    });
    owners.on('connection', (socket) => {
      void socket.join(OWNERS_ROOM);
    });

    // ── stacks: a customer's CRM checking in ────────────────────────────────────────────
    link.use((socket, next) => {
      void (async () => {
        const auth = socket.handshake.auth as {
          stackId?: unknown;
          secret?: unknown;
          protocol?: unknown;
        };
        if (typeof auth.stackId !== 'string' || typeof auth.secret !== 'string') {
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        if (auth.protocol !== LINK_PROTOCOL) {
          next(new Error('UNSUPPORTED_PROTOCOL'));
          return;
        }
        const stack = await app.stacks.authenticate(auth.stackId, auth.secret);
        if (!stack) {
          app.log.warn(
            { stackId: auth.stackId, ip: socket.handshake.address },
            'stack link refused',
          );
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        socket.data = {
          stackId: stack.id,
          customerId: stack.customerId,
          tokens: EVENTS_PER_SECOND,
        };
        next();
      })().catch(() => {
        next(new Error('UNAUTHENTICATED'));
      });
    });

    link.on('connection', (socket) => {
      const { stackId, customerId } = socket.data as { stackId: string; customerId: string };

      // Newest wins: a redeployed stack reconnects before the old socket times out, and two
      // sockets claiming the same stack would fight over the row.
      const previous = live.get(stackId);
      if (previous && previous.id !== socket.id) previous.disconnect(true);
      live.set(stackId, socket);
      void socket.join(`stack:${stackId}`);

      const bucket = { tokens: EVENTS_PER_SECOND, at: Date.now() };
      socket.use((_event, next) => {
        const elapsed = (Date.now() - bucket.at) / 1000;
        bucket.tokens = Math.min(EVENTS_PER_SECOND, bucket.tokens + elapsed * EVENTS_PER_SECOND);
        bucket.at = Date.now();
        if (bucket.tokens < 1) {
          socket.disconnect(true);
          return;
        }
        bucket.tokens -= 1;
        next();
      });

      const announceFleet = async () => {
        const row = await app.db.stack.findUnique({ where: { id: stackId } });
        if (!row) return;
        toOwners('fleet:stack', {
          at: nowIso(),
          customerId,
          stackId,
          connected: row.connected,
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          version: row.version,
          usage: (row.usage ?? null) as never,
          readyOk: ((row.health ?? null) as { ok?: boolean } | null)?.ok ?? null,
          lastBackupAt: row.lastBackupAt?.toISOString() ?? null,
        });
      };

      socket.on('hello', (raw: unknown) => {
        void (async () => {
          const parsed = stackToConsoleEvents.hello.safeParse(raw);
          if (!parsed.success) return;
          const h = parsed.data;
          await app.db.stack.update({
            where: { id: stackId },
            data: {
              connected: true,
              lastSeenAt: new Date(),
              version: h.version,
              domain: h.domain,
              startedAt: new Date(h.startedAt),
              currentIssueId: h.entitlements.issueId,
            },
          });
          app.log.info({ stackId, version: h.version, domain: h.domain }, 'stack connected');
          await announceFleet();
          // A stack that came back holding an older document gets the current one unprompted.
          await deliverOutstanding(stackId);
        })().catch((err: unknown) => {
          app.log.error({ err, stackId }, 'hello failed');
        });
      });

      socket.on('heartbeat', (raw: unknown) => {
        void (async () => {
          const parsed = stackToConsoleEvents.heartbeat.safeParse(raw);
          if (!parsed.success) return;
          const h = parsed.data;
          await app.db.stack.update({
            where: { id: stackId },
            data: {
              connected: true,
              lastSeenAt: new Date(h.at),
              version: h.version,
              usage: h.usage,
              health: h.ready,
              lastBackupAt: h.lastBackupAt === null ? null : new Date(h.lastBackupAt),
              currentIssueId: h.entitlements.issueId,
            },
          });
          await sample(stackId, customerId, h);
          await announceFleet();
        })().catch((err: unknown) => {
          app.log.error({ err, stackId }, 'heartbeat failed');
        });
      });

      socket.on('ack', (raw: unknown) => {
        void (async () => {
          const parsed = stackToConsoleEvents.ack.safeParse(raw);
          if (!parsed.success) return;
          const a = parsed.data;
          const status = a.result === 'applied' ? 'acked' : 'rejected';
          await app.db.entitlementIssue.updateMany({
            where: { id: a.issueId, stackId },
            data: {
              status,
              ackedAt: new Date(a.appliedAt),
              rejectReason: a.reason ?? null,
            },
          });
          if (a.result === 'applied') {
            await app.db.stack.update({
              where: { id: stackId },
              data: { currentIssueId: a.issueId },
            });
          } else {
            app.log.warn(
              { stackId, issueId: a.issueId, reason: a.reason },
              'stack rejected a document',
            );
          }
          toOwners('issue:status', {
            at: nowIso(),
            customerId,
            stackId,
            issueId: a.issueId,
            status,
            reason: a.reason ?? null,
          });
        })().catch((err: unknown) => {
          app.log.error({ err, stackId }, 'ack failed');
        });
      });

      socket.on('commandResult', (raw: unknown) => {
        const parsed = stackToConsoleEvents.commandResult.safeParse(raw);
        if (!parsed.success) {
          app.log.warn({ stackId }, 'a stack answered a support command with a bad shape');
          return;
        }
        const settle = waiting.get(parsed.data.commandId);
        if (!settle) return;
        waiting.delete(parsed.data.commandId);
        settle(parsed.data);
      });

      socket.on('disconnect', () => {
        void (async () => {
          // Only if this socket is still the one on record: a replaced socket already handed over.
          if (live.get(stackId)?.id !== socket.id) return;
          live.delete(stackId);
          await app.db.stack.update({ where: { id: stackId }, data: { connected: false } });
          app.log.info({ stackId }, 'stack disconnected');
          await announceFleet();
        })().catch(() => undefined);
      });
    });

    /**
     * Keeps one heartbeat in five minutes as a row, so the console can draw what a stack has been
     * doing rather than only what it is doing. The Valkey key is the gate: whoever sets it first
     * writes the sample, and everything in between is dropped on the floor deliberately.
     */
    async function sample(
      stackId: string,
      customerId: string,
      h: {
        at: string;
        version: string;
        ready: { ok: boolean };
        usage: {
          seatsActive: number;
          storageBytes: number;
          attachmentsBytes: number;
          recordingsBytes: number;
          backupsBytes: number;
        };
        lastBackupAt: string | null;
      },
    ): Promise<void> {
      const first = await app.valkey.set(
        `console:sample:${stackId}`,
        '1',
        'PX',
        SAMPLE_EVERY_MS,
        'NX',
      );
      if (first !== 'OK') return;
      await app.db.stackSample.create({
        data: {
          id: newId(),
          stackId,
          customerId,
          at: new Date(h.at),
          seatsActive: h.usage.seatsActive,
          storageBytes: BigInt(h.usage.storageBytes),
          attachmentsBytes: BigInt(h.usage.attachmentsBytes),
          recordingsBytes: BigInt(h.usage.recordingsBytes),
          backupsBytes: BigInt(h.usage.backupsBytes),
          readyOk: h.ready.ok,
          version: h.version,
          lastBackupAt: h.lastBackupAt === null ? null : new Date(h.lastBackupAt),
        },
      });
    }

    /** Sends whatever is still outstanding for a stack, newest first. */
    async function deliverOutstanding(stackId: string): Promise<void> {
      const issue = await app.db.entitlementIssue.findFirst({
        where: { stackId, status: 'pending' },
        orderBy: { issuedAt: 'desc' },
      });
      if (!issue) return;
      const room = `stack:${stackId}`;
      const socket = live.get(stackId);
      if (socket) {
        socket.emit('entitlements', { envelope: issue.envelope, issueId: issue.id });
      } else {
        // The socket belongs to another process: the issue scripts run in their own container, and
        // a second api replica would be the same situation. The adapter carries a room emit there,
        // but only after asking whether anybody is in the room, because a document nobody received
        // must stay pending rather than be recorded as delivered.
        const elsewhere = await link.in(room).fetchSockets();
        if (elsewhere.length === 0) return;
        link.to(room).emit('entitlements', { envelope: issue.envelope, issueId: issue.id });
      }
      await app.db.entitlementIssue.update({
        where: { id: issue.id },
        data: { status: 'delivered', deliveredAt: new Date() },
      });
      const stack = await app.db.stack.findUnique({ where: { id: stackId } });
      if (stack) {
        toOwners('issue:status', {
          at: nowIso(),
          customerId: stack.customerId,
          stackId,
          issueId: issue.id,
          status: 'delivered',
          reason: null,
        });
      }
    }

    // A stack whose process died without a clean disconnect would otherwise look connected.
    const sweeper = setInterval(() => {
      void (async () => {
        const stale = await app.db.stack.findMany({
          where: {
            connected: true,
            OR: [
              { lastSeenAt: null },
              { lastSeenAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
            ],
          },
          select: { id: true, customerId: true },
        });
        for (const s of stale) {
          if (live.has(s.id)) continue;
          await app.db.stack.update({ where: { id: s.id }, data: { connected: false } });
          toOwners('fleet:stack', {
            at: nowIso(),
            customerId: s.customerId,
            stackId: s.id,
            connected: false,
            lastSeenAt: null,
            version: null,
            usage: null,
            readyOk: null,
            lastBackupAt: null,
          });
        }
      })().catch(() => undefined);
    }, SWEEP_EVERY_MS);
    sweeper.unref();

    const api: ConsoleLink = {
      async deliver(issues) {
        for (const issue of issues) await deliverOutstanding(issue.stackId);
      },
      announce(stackIds, message) {
        let delivered = 0;
        for (const id of stackIds) {
          const socket = live.get(id);
          if (!socket) continue;
          socket.emit('announce', message);
          delivered++;
        }
        return delivered;
      },
      disconnect(stackId) {
        live.get(stackId)?.disconnect(true);
      },
      connectedStacks: () => [...live.keys()],
      command(stackId, payload, timeoutMs) {
        const socket = live.get(stackId);
        if (!socket) return Promise.resolve(null);
        return new Promise<unknown>((resolve) => {
          const timer = setTimeout(() => {
            waiting.delete(payload.commandId);
            resolve(null);
          }, timeoutMs);
          waiting.set(payload.commandId, (answer) => {
            clearTimeout(timer);
            resolve(answer);
          });
          socket.emit('command', payload);
        });
      },
      ping(stackId) {
        const socket = live.get(stackId);
        if (!socket) return false;
        socket.emit('ping', { at: nowIso() });
        return true;
      },
    };

    app.decorate('io', io);
    app.decorate('link', api);
    app.addHook('onClose', async () => {
      clearInterval(sweeper);
      await io.close();
      await pub.quit().catch(() => undefined);
      await sub.quit().catch(() => undefined);
    });
  },
  { name: 'link', dependencies: ['auth', 'services'] },
);
