import { z } from 'zod';
import { NotificationType, valuesOf } from '../enums.js';
import { isoDateTime, paginationCursor, uuid } from './common.js';

export const notificationDto = z.object({
  id: uuid,
  type: z.enum(valuesOf(NotificationType)),
  title: z.string(),
  body: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  readAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type NotificationDto = z.infer<typeof notificationDto>;

export const listNotificationsQuery = paginationCursor.extend({
  unread: z.enum(['true', 'false']).optional(),
});

export const notificationPreferenceDto = z.object({
  type: z.enum(valuesOf(NotificationType)),
  inApp: z.boolean(),
  email: z.boolean(),
});

export const updatePreferencesBody = z
  .object({ preferences: z.array(notificationPreferenceDto).min(1).max(20) })
  .strict();

export const unreadCountDto = z.object({ unread: z.number().int() });
