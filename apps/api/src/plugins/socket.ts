/**
 * Socket.IO server (docs/10). Cookie-authenticated handshake, authorization rooms, Valkey adapter,
 * per-user connection cap, periodic session re-validation, and domain-event fan-out.
 */
import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';
import {
  clientEvents,
  type ClientToServerEvents,
  type ServerEventName,
  type ServerEventPayload,
  type ServerToClientEvents,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server, type Socket } from 'socket.io';
import { nowIso, rooms, validatedPayload, type Broadcaster } from '../lib/realtime.js';
import { SHAPES, scopeWhere } from '../lib/scope.js';
import { resolveScope } from '@crm/shared';
import { hasRole } from './authorize.js';
import { createValkeyClient } from './valkey.js';

interface SocketData {
  userId: string;
  role: string;
  teamId: string | null;
  extension: string | null;
  sessionToken: string;
}

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const MAX_SOCKETS_PER_USER = 3;
const SESSION_RECHECK_MS = 30_000;
const EVENTS_PER_SECOND = 20;

export default fp(
  async function socketPlugin(app: FastifyInstance) {
    const validate = app.config.NODE_ENV !== 'production';

    // ── worker mode: emitter only ──────────────────────────────────────────────────────────
    if (app.config.APP_MODE === 'worker') {
      const pub = createValkeyClient(app.config.VALKEY_URL, 'socket-emitter');
      await pub.connect();
      const emitter = new Emitter(pub);
      const broadcaster: Broadcaster = {
        to: (target) => ({
          emit: <E extends ServerEventName>(event: E, payload: ServerEventPayload<E>) => {
            emitter.to(target).emit(event, validatedPayload(event, payload, validate));
          },
        }),
      };
      app.decorate('realtime', broadcaster);
      app.addHook('onClose', async () => {
        await pub.quit().catch(() => undefined);
      });
      wireDomainEvents(app, broadcaster);
      return;
    }

    // ── api mode: full server ──────────────────────────────────────────────────────────────
    const pubClient = createValkeyClient(app.config.VALKEY_URL, 'socket-pub');
    const subClient = createValkeyClient(app.config.VALKEY_URL, 'socket-sub');
    await Promise.all([pubClient.connect(), subClient.connect()]);

    const io = new Server<
      ClientToServerEvents,
      ServerToClientEvents,
      Record<string, never>,
      SocketData
    >(app.server, {
      path: '/socket.io',
      transports: ['websocket'],
      serveClient: false,
      cors: { origin: [app.config.APP_URL, ...app.config.DEV_ORIGINS], credentials: true },
      maxHttpBufferSize: 64 * 1024,
      pingInterval: 25_000,
      pingTimeout: 20_000,
      adapter: createAdapter(pubClient, subClient),
    });

    const perUser = new Map<string, Set<string>>();

    io.use((socket, next) => {
      void (async () => {
        try {
          const session = await app.getSession(socket.handshake.headers);
          if (!session) {
            next(new Error('UNAUTHENTICATED'));
            return;
          }
          const fresh = await app.db.user.findUnique({
            where: { id: session.user.id },
            select: { isActive: true, banned: true, role: true, teamId: true, extension: true },
          });
          if (!fresh?.isActive || fresh.banned === true) {
            next(new Error('UNAUTHENTICATED'));
            return;
          }
          const existing = perUser.get(session.user.id) ?? new Set<string>();
          if (existing.size >= MAX_SOCKETS_PER_USER) {
            next(new Error('TOO_MANY_CONNECTIONS'));
            return;
          }
          socket.data = {
            userId: session.user.id,
            role: fresh.role ?? 'agent',
            teamId: fresh.teamId,
            extension: fresh.extension,
            sessionToken: session.session.token,
          };
          next();
        } catch (err) {
          app.log.error({ err }, 'socket handshake failed');
          next(new Error('UNAUTHENTICATED'));
        }
      })();
    });

    io.on('connection', (socket: AppSocket) => {
      const { userId, role, teamId, extension } = socket.data;
      const set = perUser.get(userId) ?? new Set<string>();
      set.add(socket.id);
      perUser.set(userId, set);

      void socket.join(rooms.user(userId));
      void socket.join(rooms.all);
      if (extension) void socket.join(rooms.ext(extension));
      if (teamId) void socket.join(rooms.team(teamId));
      for (const r of ['admin', 'manager', 'agent'])
        if (hasRole(role, r)) void socket.join(rooms.role(r));

      // periodic session re-validation (revocation, deactivation) — docs/10 §2.5
      const recheck = setInterval(() => {
        void (async () => {
          const session = await app.db.session.findFirst({
            where: { token: socket.data.sessionToken, expiresAt: { gt: new Date() } },
            select: { id: true },
          });
          const user = session
            ? await app.db.user.findUnique({
                where: { id: userId },
                select: { isActive: true, banned: true },
              })
            : null;
          if (!session || !user?.isActive || user.banned === true) socket.disconnect(true);
        })().catch(() => undefined);
      }, SESSION_RECHECK_MS);
      recheck.unref();

      // simple token bucket per socket for inbound events (docs/08 G2)
      let tokens = EVENTS_PER_SECOND;
      const refill = setInterval(() => {
        tokens = EVENTS_PER_SECOND;
      }, 1000);
      refill.unref();
      socket.use((_packet, next) => {
        if (tokens <= 0) {
          socket.disconnect(true);
          return;
        }
        tokens--;
        next();
      });

      socket.on('conv:join', (raw) => {
        void (async () => {
          const parsed = clientEvents['conv:join'].safeParse(raw);
          if (!parsed.success) return;
          if (!(await app.entitlements.has('messaging'))) return;
          const scope = resolveScope(
            { id: userId, role, teamId },
            await app.settings.get('agentVisibility'),
          );
          const conv = await app.db.conversation.findFirst({
            where: { id: parsed.data.conversationId, ...scopeWhere(scope, SHAPES.conversation) },
            select: { id: true },
          });
          if (conv) await socket.join(rooms.conv(conv.id));
        })().catch(() => undefined);
      });
      socket.on('conv:leave', (raw) => {
        const parsed = clientEvents['conv:leave'].safeParse(raw);
        if (parsed.success) void socket.leave(rooms.conv(parsed.data.conversationId));
      });
      socket.on('entity:watch', (raw) => {
        const parsed = clientEvents['entity:watch'].safeParse(raw);
        if (parsed.success) void socket.join(rooms.entity(parsed.data.type, parsed.data.id));
      });
      socket.on('entity:unwatch', (raw) => {
        const parsed = clientEvents['entity:unwatch'].safeParse(raw);
        if (parsed.success) void socket.leave(rooms.entity(parsed.data.type, parsed.data.id));
      });
      let lastPing = 0;
      socket.on('presence:ping', () => {
        const now = Date.now();
        if (now - lastPing < 60_000) return;
        lastPing = now;
        app.db.user
          .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
          .catch(() => undefined);
      });

      socket.on('disconnect', () => {
        clearInterval(recheck);
        clearInterval(refill);
        const s = perUser.get(userId);
        if (s) {
          s.delete(socket.id);
          if (s.size === 0) perUser.delete(userId);
        }
      });
    });

    const broadcaster: Broadcaster = {
      to: (target) => ({
        emit: <E extends ServerEventName>(event: E, payload: ServerEventPayload<E>) => {
          const room = io.to(target) as unknown as { emit: (name: string, data: unknown) => void };
          room.emit(event, validatedPayload(event, payload, validate));
        },
      }),
    };
    app.decorate('io', io);
    app.decorate('realtime', broadcaster);
    wireDomainEvents(app, broadcaster);

    app.addHook('onClose', async () => {
      io.local.emit('system:announce', {
        at: nowIso(),
        level: 'info',
        message: 'Server restarting',
      });
      await io.close();
      await Promise.all([
        pubClient.quit().catch(() => undefined),
        subClient.quit().catch(() => undefined),
      ]);
    });
  },
  { name: 'socket', dependencies: ['auth', 'event-bus', 'services'] },
);

/** Domain events → socket events (both processes). */
function wireDomainEvents(app: FastifyInstance, rt: Broadcaster): void {
  app.events.on('entitlements.changed', (e) => {
    rt.to(rooms.all).emit('entitlements:changed', {
      at: nowIso(),
      plan: e.plan,
      features: e.features,
      expiresAt: e.expiresAt,
      issueId: e.issueId,
    });
  });
  app.events.on('notification.created', (n) => {
    rt.to(rooms.user(n.userId)).emit('notification:new', {
      at: nowIso(),
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data,
      createdAt: n.createdAt,
    });
  });
  app.events.on('entity.changed', (e) => {
    rt.to(rooms.entity(e.type, e.id)).emit('entity:changed', {
      at: nowIso(),
      type: e.type,
      id: e.id,
      updatedAt: e.updatedAt,
      byUserId: e.byUserId,
    });
  });
  app.events.on('deal.stage_changed', (e) => {
    const targets = [
      rooms.role('manager'),
      rooms.role('admin'),
      ...(e.ownerId ? [rooms.user(e.ownerId)] : []),
    ];
    rt.to(targets).emit('deal:stage', {
      at: nowIso(),
      dealId: e.dealId,
      title: e.title,
      fromStage: e.fromStage,
      toStage: e.toStage,
      byUserId: e.byUserId,
    });
    if (e.ownerId && e.byUserId !== e.ownerId) {
      void app.notifications.notify({
        userId: e.ownerId,
        type: 'deal_stage',
        title: `Deal "${e.title}" moved to ${e.toStage}`,
        body: null,
        data: { dealId: e.dealId, url: `/deals/${e.dealId}` },
      });
    }
  });
  app.events.on('task.created', (e) => {
    if (e.assigneeId)
      rt.to(rooms.user(e.assigneeId)).emit('entity:changed', {
        at: nowIso(),
        type: 'task',
        id: e.taskId,
        updatedAt: nowIso(),
        byUserId: e.byUserId,
      });
  });
}
