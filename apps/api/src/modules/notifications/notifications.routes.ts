import {
  cursorListResponse,
  dataResponse,
  idParams,
  listNotificationsQuery,
  notificationDto,
  notificationPreferenceDto,
  unreadCountDto,
  updatePreferencesBody,
  type NotificationDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { decodeCursor, pageOf } from '../../lib/pagination.js';
import { requireUser } from '../../lib/request.js';
import { DEFAULT_PREFERENCES } from './notifications.service.js';

function toDto(r: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: r.id,
    type: r.type as NotificationDto['type'],
    title: r.title,
    body: r.body,
    data: (r.data ?? {}) as Record<string, unknown>,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const notificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/notifications', {
    config: { auth: { permission: 'notification:manage_own' } },
    schema: {
      tags: ['notifications'],
      querystring: listNotificationsQuery,
      response: { 200: cursorListResponse(notificationDto) },
    },
    handler: async (request) => {
      const user = requireUser(request);
      const cursor = decodeCursor(request.query.cursor);
      const rows = await app.db.notification.findMany({
        where: {
          userId: user.id,
          ...(request.query.unread === 'true' ? { readAt: null } : {}),
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.at } },
                  { createdAt: cursor.at, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: request.query.limit + 1,
      });
      const page = pageOf(rows, request.query.limit, (r) => r.createdAt);
      return { data: page.data.map(toDto), page: page.page };
    },
  });

  app.get('/notifications/unread-count', {
    config: { auth: { permission: 'notification:manage_own' } },
    schema: { tags: ['notifications'], response: { 200: dataResponse(unreadCountDto) } },
    handler: async (request) => ({
      data: {
        unread: await app.db.notification.count({
          where: { userId: requireUser(request).id, readAt: null },
        }),
      },
    }),
  });

  app.post('/notifications/read-all', {
    config: { auth: { permission: 'notification:manage_own' } },
    schema: { tags: ['notifications'], response: { 204: z.null() } },
    handler: async (request, reply) => {
      await app.db.notification.updateMany({
        where: { userId: requireUser(request).id, readAt: null },
        data: { readAt: new Date() },
      });
      return reply.status(204).send(null);
    },
  });

  app.post('/notifications/:id/read', {
    config: { auth: { permission: 'notification:manage_own' } },
    schema: {
      tags: ['notifications'],
      params: idParams,
      response: { 200: dataResponse(notificationDto) },
    },
    handler: async (request) => {
      const user = requireUser(request);
      const row = await app.db.notification.findFirst({
        where: { id: request.params.id, userId: user.id },
      });
      if (!row) throw new NotFoundError('Notification');
      const updated = row.readAt
        ? row
        : await app.db.notification.update({ where: { id: row.id }, data: { readAt: new Date() } });
      return { data: toDto(updated) };
    },
  });

  app.get('/notifications/preferences', {
    config: { auth: { permission: 'notification:manage_own' } },
    schema: {
      tags: ['notifications'],
      response: { 200: dataResponse(z.array(notificationPreferenceDto)) },
    },
    handler: async (request) => {
      const prefs = await app.notifications.preferencesFor(requireUser(request).id);
      return {
        data: (Object.keys(DEFAULT_PREFERENCES) as (keyof typeof DEFAULT_PREFERENCES)[]).map(
          (type) => ({ type, ...prefs[type] }),
        ),
      };
    },
  });

  app.put('/notifications/preferences', {
    config: { auth: { permission: 'notification:manage_own' } },
    schema: {
      tags: ['notifications'],
      body: updatePreferencesBody,
      response: { 200: dataResponse(z.array(notificationPreferenceDto)) },
    },
    handler: async (request) => {
      const user = requireUser(request);
      await app.db.$transaction(
        request.body.preferences.map((p) =>
          app.db.notificationPreference.upsert({
            where: { userId_type: { userId: user.id, type: p.type } },
            create: { userId: user.id, type: p.type, inApp: p.inApp, email: p.email },
            update: { inApp: p.inApp, email: p.email },
          }),
        ),
      );
      const prefs = await app.notifications.preferencesFor(user.id);
      return {
        data: (Object.keys(DEFAULT_PREFERENCES) as (keyof typeof DEFAULT_PREFERENCES)[]).map(
          (type) => ({ type, ...prefs[type] }),
        ),
      };
    },
  });
};

export default notificationsRoutes;
