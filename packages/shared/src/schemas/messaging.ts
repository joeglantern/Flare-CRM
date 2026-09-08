import { z } from 'zod';
import {
  ChannelType,
  ConversationStatus,
  MessageContentType,
  MessageDirection,
  MessageStatus,
  valuesOf,
} from '../enums.js';
import { isoDateTime, paginationCursor, uuid } from './common.js';
import { userRef } from './company.js';

export const channelDto = z.object({
  id: uuid,
  type: z.enum(valuesOf(ChannelType)),
  name: z.string(),
  externalId: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
  hasSecrets: z.boolean(),
  isActive: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type ChannelDto = z.infer<typeof channelDto>;

export const createChannelBody = z
  .object({
    type: z.enum(valuesOf(ChannelType)),
    name: z.string().trim().min(1).max(80),
    externalId: z.string().trim().max(120).nullable().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    /** Provider secrets (access tokens); stored encrypted and never returned. */
    secrets: z.record(z.string(), z.string().max(4000)).optional(),
  })
  .strict();
export const updateChannelBody = createChannelBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict();

export const attachmentDto = z.object({
  id: uuid,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  url: z.string(),
});
export type AttachmentDto = z.infer<typeof attachmentDto>;

export const messageDto = z.object({
  id: uuid,
  conversationId: uuid,
  direction: z.enum(valuesOf(MessageDirection)),
  contentType: z.enum(valuesOf(MessageContentType)),
  body: z.string().nullable(),
  status: z.enum(valuesOf(MessageStatus)),
  errorMessage: z.string().nullable(),
  sentBy: userRef.nullable(),
  sentAt: isoDateTime,
  deliveredAt: isoDateTime.nullable(),
  readAt: isoDateTime.nullable(),
  attachments: z.array(attachmentDto),
  createdAt: isoDateTime,
});
export type MessageDto = z.infer<typeof messageDto>;

export const conversationDto = z.object({
  id: uuid,
  channel: z.object({ id: uuid, type: z.enum(valuesOf(ChannelType)), name: z.string() }),
  contact: z.object({ id: uuid, displayName: z.string() }).nullable(),
  contactId: uuid.nullable(),
  externalId: z.string(),
  externalDisplay: z.string(),
  status: z.enum(valuesOf(ConversationStatus)),
  assignee: userRef.nullable(),
  assigneeId: uuid.nullable(),
  lastMessageAt: isoDateTime.nullable(),
  lastInboundAt: isoDateTime.nullable(),
  /** WhatsApp customer-service window: free-form replies allowed only within 24 h of the last inbound. */
  replyWindowOpen: z.boolean(),
  unreadCount: z.number().int(),
  lastMessagePreview: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type ConversationDto = z.infer<typeof conversationDto>;

export const listConversationsQuery = paginationCursor.extend({
  status: z.enum(valuesOf(ConversationStatus)).optional(),
  assigneeId: uuid.optional(),
  mine: z.enum(['true', 'false']).optional(),
  unassigned: z.enum(['true']).optional(),
  channelId: uuid.optional(),
  contactId: uuid.optional(),
  q: z.string().trim().max(120).optional(),
});

export const listMessagesQuery = paginationCursor;

export const sendMessageBody = z
  .object({
    body: z.string().trim().min(1).max(4096).optional(),
    attachmentId: uuid.optional(),
    template: z
      .object({
        name: z.string().min(1).max(120),
        language: z.string().min(2).max(10).default('en'),
        params: z.array(z.string().max(500)).max(20).default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.body !== undefined || v.attachmentId !== undefined || v.template !== undefined, {
    message: 'body, attachmentId or template is required',
    path: ['body'],
  });
export type SendMessageBody = z.infer<typeof sendMessageBody>;

export const startConversationBody = z
  .object({
    channelId: uuid,
    contactId: uuid,
    phoneId: uuid.optional(),
  })
  .strict();

export const assignConversationBody = z.object({ assigneeId: uuid.nullable() }).strict();
