/**
 * Conversations & messages (R-5). Provider-agnostic: inbound events arrive normalized from a
 * ChannelAdapter; outbound messages are queued and delivered by the worker.
 */
import {
  formatNational,
  type ChannelType,
  type ConversationDto,
  type MessageDto,
  type SendMessageBody,
  type VisibilityScope,
  type listConversationsQuery,
  type listMessagesQuery,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ChannelSendError,
  type ChannelAdapter,
  type ChannelContext,
  type InboundEvent,
} from '../../integrations/messaging/channel-adapter.js';
import { newObjectKey } from '../../integrations/storage/storage.js';
import { QUEUES } from '../../jobs/queues.js';
import { decryptJson } from '../../lib/crypto.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { isoOrNull } from '../../lib/object.js';
import { decodeCursor, pageOf } from '../../lib/pagination.js';
import { nowIso, rooms } from '../../lib/realtime.js';
import { SHAPES, assertCanAssign, scopeWhere } from '../../lib/scope.js';
import { ATTACHMENT_TYPES } from '../../lib/uploads.js';
import type { AuditContext } from '../audit/audit.service.js';

export interface Actor {
  id: string;
  role: string;
  teamId: string | null;
  canAssign: boolean;
}

const conversationSelect = {
  id: true,
  channelId: true,
  channel: { select: { id: true, type: true, name: true } },
  contactId: true,
  contact: { select: { id: true, displayName: true } },
  externalId: true,
  status: true,
  assigneeId: true,
  assignee: { select: { id: true, name: true } },
  lastMessageAt: true,
  lastInboundAt: true,
  unreadCount: true,
  createdAt: true,
  updatedAt: true,
  messages: {
    orderBy: { sentAt: 'desc' as const },
    take: 1,
    select: { body: true, contentType: true },
  },
} satisfies Prisma.ConversationSelect;
type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;

const messageSelect = {
  id: true,
  conversationId: true,
  direction: true,
  contentType: true,
  body: true,
  status: true,
  errorMessage: true,
  sentById: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  createdAt: true,
  attachments: { select: { id: true, key: true, fileName: true, mimeType: true, sizeBytes: true } },
} satisfies Prisma.MessageSelect;
type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export class MessagingService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly adapters: Map<ChannelType, ChannelAdapter>,
  ) {}

  private get db() {
    return this.app.db;
  }

  adapterFor(type: string): ChannelAdapter {
    const adapter = this.adapters.get(type as ChannelType);
    if (!adapter) throw new ConflictError(`No adapter configured for channel type "${type}"`);
    return adapter;
  }

  async channelContext(channelId: string): Promise<ChannelContext> {
    const row = await this.db.channel.findUnique({ where: { id: channelId } });
    if (!row) throw new NotFoundError('Channel');
    const secrets = row.secretsEncrypted
      ? (decryptJson(row.secretsEncrypted, this.app.config.SECRETS_KEY) as Record<string, string>)
      : {};
    return {
      id: row.id,
      type: row.type as ChannelType,
      externalId: row.externalId,
      config: (row.config ?? {}) as Record<string, unknown>,
      secrets,
    };
  }

  // ── mapping ──────────────────────────────────────────────────────────────────────────

  conversationToDto(r: ConversationRow): ConversationDto {
    const adapter = this.adapters.get(r.channel.type as ChannelType);
    const e164 = adapter?.e164For(r.externalId) ?? null;
    const last = r.messages[0];
    return {
      id: r.id,
      channel: { id: r.channel.id, type: r.channel.type as ChannelType, name: r.channel.name },
      contact: r.contact,
      contactId: r.contactId,
      externalId: r.externalId,
      externalDisplay: e164 ? formatNational(e164) : r.externalId,
      status: r.status as ConversationDto['status'],
      assignee: r.assignee,
      assigneeId: r.assigneeId,
      lastMessageAt: isoOrNull(r.lastMessageAt),
      lastInboundAt: isoOrNull(r.lastInboundAt),
      replyWindowOpen:
        r.lastInboundAt !== null && Date.now() - r.lastInboundAt.getTime() < REPLY_WINDOW_MS,
      unreadCount: r.unreadCount,
      lastMessagePreview: last ? (last.body ?? `[${last.contentType}]`).slice(0, 120) : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private messageToDto(r: MessageRow, names: Map<string, string>): MessageDto {
    return {
      id: r.id,
      conversationId: r.conversationId,
      direction: r.direction as MessageDto['direction'],
      contentType: r.contentType as MessageDto['contentType'],
      body: r.body,
      status: r.status as MessageDto['status'],
      errorMessage: r.errorMessage,
      sentBy: r.sentById ? { id: r.sentById, name: names.get(r.sentById) ?? 'Unknown' } : null,
      sentAt: r.sentAt.toISOString(),
      deliveredAt: isoOrNull(r.deliveredAt),
      readAt: isoOrNull(r.readAt),
      attachments: r.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: Number(a.sizeBytes),
        url: `/api/v1/files/${encodeURIComponent(a.key)}`,
      })),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private convScope(scope: VisibilityScope): Prisma.ConversationWhereInput {
    if (scope.kind === 'all') return {};
    return {
      OR: [
        scopeWhere(scope, SHAPES.conversation),
        { contact: scopeWhere(scope, SHAPES.contact) },
        ...(scope.kind === 'team' ? [{ assigneeId: null }] : []),
      ],
    };
  }

  // ── queries ──────────────────────────────────────────────────────────────────────────

  async list(scope: VisibilityScope, actorId: string, q: z.infer<typeof listConversationsQuery>) {
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.ConversationWhereInput = {
      AND: [
        this.convScope(scope),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.assigneeId ? [{ assigneeId: q.assigneeId }] : []),
        ...(q.mine === 'true' ? [{ assigneeId: actorId }] : []),
        ...(q.unassigned ? [{ assigneeId: null }] : []),
        ...(q.channelId ? [{ channelId: q.channelId }] : []),
        ...(q.contactId ? [{ contactId: q.contactId }] : []),
        ...(q.q
          ? [
              {
                OR: [
                  { externalId: { contains: q.q.replace(/\D/g, '') || q.q } },
                  { contact: { displayName: { contains: q.q, mode: 'insensitive' as const } } },
                ],
              },
            ]
          : []),
        ...(cursor
          ? [
              {
                OR: [
                  { lastMessageAt: { lt: cursor.at } },
                  { lastMessageAt: cursor.at, id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    };
    const rows = await this.db.conversation.findMany({
      where,
      select: conversationSelect,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) => r.lastMessageAt ?? r.createdAt);
    return { data: page.data.map((r) => this.conversationToDto(r)), page: page.page };
  }

  async getVisible(scope: VisibilityScope, id: string): Promise<ConversationRow> {
    const row = await this.db.conversation.findFirst({
      where: { id, ...this.convScope(scope) },
      select: conversationSelect,
    });
    if (!row) throw new NotFoundError('Conversation');
    return row;
  }

  async messages(
    scope: VisibilityScope,
    conversationId: string,
    q: z.infer<typeof listMessagesQuery>,
  ) {
    await this.getVisible(scope, conversationId);
    const cursor = decodeCursor(q.cursor);
    const rows = await this.db.message.findMany({
      where: {
        conversationId,
        ...(cursor
          ? { OR: [{ sentAt: { lt: cursor.at } }, { sentAt: cursor.at, id: { lt: cursor.id } }] }
          : {}),
      },
      select: messageSelect,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) => r.sentAt);
    const ids = [
      ...new Set(page.data.map((r) => r.sentById).filter((v): v is string => v !== null)),
    ];
    const users = ids.length
      ? await this.db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { data: page.data.map((r) => this.messageToDto(r, names)), page: page.page };
  }

  // ── inbound ──────────────────────────────────────────────────────────────────────────

  async handleInbound(
    channelType: ChannelType,
    payload: unknown,
  ): Promise<{ messages: number; statuses: number }> {
    const adapter = this.adapterFor(channelType);
    let messages = 0;
    let statuses = 0;
    for (const batch of adapter.parseInbound(payload)) {
      const channel = await this.db.channel.findFirst({
        where: {
          type: channelType,
          isActive: true,
          ...(batch.channelExternalId ? { externalId: batch.channelExternalId } : {}),
        },
      });
      if (!channel) {
        this.app.log.warn(
          { channelType, externalId: batch.channelExternalId },
          'inbound message for unknown channel',
        );
        continue;
      }
      for (const event of batch.events) {
        if (event.kind === 'message') {
          if (await this.ingestMessage(channel.id, adapter, event)) messages++;
        } else {
          await this.applyStatus(event);
          statuses++;
        }
      }
    }
    return { messages, statuses };
  }

  private async ingestMessage(
    channelId: string,
    adapter: ChannelAdapter,
    event: Extract<InboundEvent, { kind: 'message' }>,
  ): Promise<boolean> {
    const e164 = adapter.e164For(event.from);
    const contact = e164
      ? await this.db.contactPhone.findFirst({
          where: { e164, deletedAt: null, contact: { deletedAt: null } },
          select: {
            contact: { select: { id: true, displayName: true, companyId: true, ownerId: true } },
          },
        })
      : null;
    const contactRow = contact?.contact ?? null;

    let conversation = await this.db.conversation.findUnique({
      where: { channelId_externalId: { channelId, externalId: event.from } },
      select: { id: true, assigneeId: true, contactId: true, status: true },
    });
    if (!conversation) {
      const created = await this.db.conversation.create({
        data: {
          id: newId(),
          channelId,
          externalId: event.from,
          contactId: contactRow?.id ?? null,
          status: 'open',
          assigneeId: contactRow?.ownerId ?? null,
        },
        select: { id: true, assigneeId: true, contactId: true, status: true },
      });
      conversation = created;
    } else if (!conversation.contactId && contactRow) {
      await this.db.conversation.update({
        where: { id: conversation.id },
        data: { contactId: contactRow.id },
      });
      conversation = { ...conversation, contactId: contactRow.id };
    }

    const existing = await this.db.message.findUnique({
      where: {
        conversationId_externalMessageId: {
          conversationId: conversation.id,
          externalMessageId: event.externalId,
        },
      },
      select: { id: true },
    });
    if (existing) return false; // provider retry

    const messageId = newId();
    const channelCtx = await this.channelContext(channelId);
    const attachments: {
      id: string;
      key: string;
      fileName: string;
      mimeType: string;
      sizeBytes: bigint;
      sha256: string;
    }[] = [];
    for (const m of event.media) {
      try {
        const file = await adapter.downloadMedia(channelCtx, m.providerMediaId);
        const mimeType = m.mimeType ?? file.mimeType;
        if (!ATTACHMENT_TYPES.has(mimeType) || file.buffer.length > 25 * 1024 * 1024) {
          this.app.log.warn({ mimeType, size: file.buffer.length }, 'inbound media rejected');
          continue;
        }
        const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
        const key = newObjectKey('attachments', ext);
        const put = await this.app.storage.put(key, file.buffer, mimeType);
        await this.app.storageUsage.add('attachments', put.size);
        attachments.push({
          id: newId(),
          key,
          fileName: m.fileName ?? file.fileName ?? `${m.providerMediaId}.${ext}`,
          mimeType,
          sizeBytes: BigInt(put.size),
          sha256: put.sha256,
        });
      } catch (err) {
        this.app.log.error({ err, mediaId: m.providerMediaId }, 'inbound media download failed');
      }
    }

    await this.db.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          id: messageId,
          conversationId: conversation.id,
          direction: 'inbound',
          externalMessageId: event.externalId,
          contentType: event.contentType,
          body: event.body ?? null,
          status: 'received',
          sentAt: event.sentAt,
          raw: event.raw as object,
          attachments: { create: attachments },
        },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: event.sentAt,
          lastInboundAt: event.sentAt,
          unreadCount: { increment: 1 },
          status: 'open',
        },
      });
      if (conversation.contactId) {
        await this.app.activity.record(tx, {
          type: 'message',
          contactId: conversation.contactId,
          companyId: contactRow?.companyId ?? null,
          actorId: null,
          occurredAt: event.sentAt,
          summary: `Inbound ${channelCtx.type} message: ${(event.body ?? `[${event.contentType}]`).slice(0, 120)}`,
          refTable: 'messages',
          refId: messageId,
          meta: {
            direction: 'inbound',
            channel: channelCtx.type,
            contentType: event.contentType,
            text: event.body ?? '',
            attachments: attachments.length,
          },
        });
      }
    });

    const preview = (event.body ?? `[${event.contentType}]`).slice(0, 120);
    const display =
      contactRow?.displayName ?? event.profileName ?? (e164 ? formatNational(e164) : event.from);
    const targets = new Set<string>();
    if (conversation.assigneeId) targets.add(conversation.assigneeId);
    const payload = {
      at: nowIso(),
      conversationId: conversation.id,
      messageId,
      channelType: channelCtx.type,
      contact: contactRow ? { id: contactRow.id, displayName: contactRow.displayName } : null,
      preview,
      direction: 'inbound' as const,
    };
    const roomsToNotify = [
      rooms.conv(conversation.id),
      rooms.role('manager'),
      rooms.role('admin'),
      ...[...targets].map((u) => rooms.user(u)),
    ];
    if (!conversation.assigneeId) roomsToNotify.push(rooms.role('agent'));
    this.app.realtime.to(roomsToNotify).emit('message:new', payload);
    for (const userId of targets) {
      await this.app.notifications.notify({
        userId,
        type: 'message_new',
        title: `New message from ${display}`,
        body: preview,
        data: {
          conversationId: conversation.id,
          contactId: conversation.contactId,
          url: `/inbox/${conversation.id}`,
        },
      });
    }
    return true;
  }

  private async applyStatus(event: Extract<InboundEvent, { kind: 'status' }>): Promise<void> {
    const message = await this.db.message.findFirst({
      where: { externalMessageId: event.externalId, direction: 'outbound' },
      select: { id: true, conversationId: true, status: true, sentById: true },
    });
    if (!message) return;
    const order = ['queued', 'sent', 'delivered', 'read'];
    if (event.status !== 'failed' && order.indexOf(event.status) < order.indexOf(message.status))
      return; // out-of-order delivery
    await this.db.message.update({
      where: { id: message.id },
      data: {
        status: event.status,
        ...(event.status === 'delivered' ? { deliveredAt: event.at } : {}),
        ...(event.status === 'read' ? { readAt: event.at, deliveredAt: event.at } : {}),
        ...(event.status === 'failed' && event.error
          ? { errorCode: event.error.code, errorMessage: event.error.message }
          : {}),
      },
    });
    this.app.realtime
      .to([
        rooms.conv(message.conversationId),
        ...(message.sentById ? [rooms.user(message.sentById)] : []),
      ])
      .emit('message:status', {
        at: nowIso(),
        messageId: message.id,
        status: event.status,
        errorMessage: event.error?.message ?? null,
      });
  }

  // ── outbound ─────────────────────────────────────────────────────────────────────────

  async send(
    scope: VisibilityScope,
    actor: Actor,
    conversationId: string,
    body: SendMessageBody,
    ctx: AuditContext,
  ): Promise<MessageDto> {
    const conv = await this.getVisible(scope, conversationId);
    const adapter = this.adapterFor(conv.channel.type);
    const caps = adapter.capabilities();
    if (conv.status === 'archived') throw new ConflictError('Conversation is archived');
    if (caps.replyWindowHours !== null && !body.template) {
      const open =
        conv.lastInboundAt !== null &&
        Date.now() - conv.lastInboundAt.getTime() < caps.replyWindowHours * 60 * 60 * 1000;
      if (!open)
        throw new AppError(
          'TEMPLATE_REQUIRED',
          409,
          `The ${String(caps.replyWindowHours)}-hour reply window is closed; send an approved template instead`,
        );
    }
    if (body.template && !caps.templates)
      throw new ValidationError([
        { path: 'template', message: 'This channel does not support templates' },
      ]);
    let attachment: { id: string; messageId: string | null } | null = null;
    if (body.attachmentId) {
      if (!caps.media)
        throw new ValidationError([
          { path: 'attachmentId', message: 'This channel does not support media' },
        ]);
      attachment = await this.db.attachment.findFirst({
        where: { id: body.attachmentId, uploadedById: actor.id },
        select: { id: true, messageId: true },
      });
      if (!attachment)
        throw new ValidationError([{ path: 'attachmentId', message: 'Attachment not found' }]);
      if (attachment.messageId) throw new ConflictError('Attachment already sent');
    }

    const id = newId();
    const contentType = body.template ? 'template' : attachment ? 'document' : 'text';
    await this.db.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          id,
          conversationId,
          direction: 'outbound',
          contentType,
          body: body.body ?? (body.template ? `[template:${body.template.name}]` : null),
          status: 'queued',
          sentById: actor.id,
          sentAt: new Date(),
          ...(body.template ? { raw: { template: body.template } } : {}),
        },
      });
      if (attachment)
        await tx.attachment.update({ where: { id: attachment.id }, data: { messageId: id } });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          ...(conv.assigneeId === null ? { assigneeId: actor.id } : {}),
        },
      });
      if (conv.contactId) {
        await this.app.activity.record(tx, {
          type: 'message',
          contactId: conv.contactId,
          actorId: actor.id,
          summary: `Outbound ${conv.channel.type} message: ${(body.body ?? `[${contentType}]`).slice(0, 120)}`,
          refTable: 'messages',
          refId: id,
          meta: {
            direction: 'outbound',
            channel: conv.channel.type,
            contentType,
            text: body.body ?? '',
          },
        });
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: 'message.send',
        entity: 'conversation',
        entityId: conversationId,
        after: { messageId: id, contentType },
      });
    });
    await this.app.queues.add(
      QUEUES.messagingOutbound,
      'send',
      { messageId: id },
      { jobId: `msg-${id}`, attempts: 4 },
    );
    const row = await this.db.message.findUniqueOrThrow({ where: { id }, select: messageSelect });
    return this.messageToDto(
      row,
      new Map([
        [
          actor.id,
          (await this.db.user.findUnique({ where: { id: actor.id }, select: { name: true } }))
            ?.name ?? '',
        ],
      ]),
    );
  }

  /** Worker: deliver a queued outbound message through the channel adapter. */
  async deliver(messageId: string, attempt: number, maxAttempts: number): Promise<void> {
    const message = await this.db.message.findUnique({
      where: { id: messageId },
      select: {
        ...messageSelect,
        raw: true,
        conversation: {
          select: { channelId: true, externalId: true, channel: { select: { type: true } } },
        },
      },
    });
    if (message?.status !== 'queued') return;
    const adapter = this.adapterFor(message.conversation.channel.type);
    const channel = await this.channelContext(message.conversation.channelId);
    try {
      const template = (
        message.raw as { template?: { name: string; language: string; params: string[] } } | null
      )?.template;
      let media:
        | { buffer: Buffer; mimeType: string; fileName: string; caption: string | undefined }
        | undefined;
      const first = message.attachments[0];
      if (first) {
        const obj = await this.app.storage.get(first.key);
        if (!obj)
          throw new ChannelSendError('ATTACHMENT_MISSING', 'Attachment no longer exists', false);
        const chunks: Buffer[] = [];
        for await (const chunk of obj.body)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
        media = {
          buffer: Buffer.concat(chunks),
          mimeType: first.mimeType,
          fileName: first.fileName,
          caption: message.body ?? undefined,
        };
      }
      const result = await adapter.send(channel, {
        to: message.conversation.externalId,
        body: message.body ?? undefined,
        media,
        template,
      });
      await this.db.message.update({
        where: { id: messageId },
        data: { status: 'sent', externalMessageId: result.externalMessageId },
      });
      this.app.realtime
        .to([
          rooms.conv(message.conversationId),
          ...(message.sentById ? [rooms.user(message.sentById)] : []),
        ])
        .emit('message:status', { at: nowIso(), messageId, status: 'sent', errorMessage: null });
    } catch (err) {
      const sendErr =
        err instanceof ChannelSendError
          ? err
          : new ChannelSendError('UNKNOWN', err instanceof Error ? err.message : String(err), true);
      const final = !sendErr.retryable || attempt >= maxAttempts;
      if (final) {
        await this.db.message.update({
          where: { id: messageId },
          data: { status: 'failed', errorCode: sendErr.code, errorMessage: sendErr.message },
        });
        this.app.realtime
          .to([
            rooms.conv(message.conversationId),
            ...(message.sentById ? [rooms.user(message.sentById)] : []),
          ])
          .emit('message:status', {
            at: nowIso(),
            messageId,
            status: 'failed',
            errorMessage: sendErr.message,
          });
        return;
      }
      throw err; // BullMQ retries with backoff
    }
  }

  // ── conversation actions ─────────────────────────────────────────────────────────────

  async start(
    scope: VisibilityScope,
    actor: Actor,
    input: { channelId: string; contactId: string; phoneId?: string | undefined },
    ctx: AuditContext,
  ): Promise<ConversationDto> {
    const channel = await this.db.channel.findFirst({
      where: { id: input.channelId, isActive: true },
    });
    if (!channel) throw new ValidationError([{ path: 'channelId', message: 'Channel not found' }]);
    const adapter = this.adapterFor(channel.type);
    const contact = await this.db.contact.findFirst({
      where: { id: input.contactId, ...scopeWhere(scope, SHAPES.contact) },
      select: {
        id: true,
        doNotCall: true,
        phones: {
          where: { deletedAt: null, ...(input.phoneId ? { id: input.phoneId } : {}) },
          orderBy: { isPrimary: 'desc' },
          take: 1,
          select: { e164: true },
        },
      },
    });
    if (!contact) throw new ValidationError([{ path: 'contactId', message: 'Contact not found' }]);
    const phone = contact.phones[0];
    if (!phone)
      throw new ValidationError([{ path: 'phoneId', message: 'Contact has no phone number' }]);
    const externalId = adapter.addressFor(phone.e164);
    const existing = await this.db.conversation.findUnique({
      where: { channelId_externalId: { channelId: channel.id, externalId } },
      select: { id: true },
    });
    let id: string;
    if (existing) {
      id = existing.id;
      await this.db.conversation.update({
        where: { id },
        data: {
          status: 'open',
          contactId: contact.id,
          ...(scope.kind === 'own' ? { assigneeId: actor.id } : {}),
        },
      });
    } else {
      id = newId();
      await this.db.conversation.create({
        data: {
          id,
          channelId: channel.id,
          externalId,
          contactId: contact.id,
          status: 'open',
          assigneeId: actor.id,
        },
      });
      await this.app.audit.write(ctx, {
        action: 'conversation.start',
        entity: 'conversation',
        entityId: id,
        after: { channelId: channel.id, contactId: contact.id },
      });
    }
    return this.conversationToDto(await this.getVisible(scope, id));
  }

  async assign(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    assigneeId: string | null,
    ctx: AuditContext,
  ): Promise<ConversationDto> {
    const conv = await this.getVisible(scope, id);
    assertCanAssign(actor.canAssign, assigneeId, actor.id);
    if (assigneeId) {
      const u = await this.db.user.findFirst({
        where: { id: assigneeId, isActive: true },
        select: { id: true },
      });
      if (!u) throw new ValidationError([{ path: 'assigneeId', message: 'User not found' }]);
    }
    await this.db.conversation.update({ where: { id }, data: { assigneeId } });
    await this.app.audit.write(ctx, {
      action: 'conversation.assign',
      entity: 'conversation',
      entityId: id,
      before: { assigneeId: conv.assigneeId },
      after: { assigneeId },
    });
    const after = this.conversationToDto(await this.getVisible(scope, id));
    this.app.realtime
      .to([rooms.conv(id), ...(assigneeId ? [rooms.user(assigneeId)] : [])])
      .emit('conversation:updated', {
        at: nowIso(),
        conversationId: id,
        status: after.status,
        assigneeId: after.assigneeId,
        unreadCount: after.unreadCount,
      });
    if (assigneeId && assigneeId !== actor.id)
      await this.app.notifications.notify({
        userId: assigneeId,
        type: 'message_new',
        title: 'Conversation assigned to you',
        body: after.lastMessagePreview,
        data: { conversationId: id, url: `/inbox/${id}` },
      });
    return after;
  }

  async setStatus(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    status: 'open' | 'closed' | 'archived',
    ctx: AuditContext,
  ): Promise<ConversationDto> {
    const conv = await this.getVisible(scope, id);
    if (scope.kind === 'own' && conv.assigneeId !== null && conv.assigneeId !== actor.id)
      throw new ForbiddenError('Only the assignee can change this conversation');
    await this.db.conversation.update({ where: { id }, data: { status } });
    await this.app.audit.write(ctx, {
      action: `conversation.${status}`,
      entity: 'conversation',
      entityId: id,
      before: { status: conv.status },
    });
    const after = this.conversationToDto(await this.getVisible(scope, id));
    this.app.realtime.to(rooms.conv(id)).emit('conversation:updated', {
      at: nowIso(),
      conversationId: id,
      status: after.status,
      assigneeId: after.assigneeId,
      unreadCount: after.unreadCount,
    });
    return after;
  }

  async markRead(scope: VisibilityScope, id: string): Promise<ConversationDto> {
    await this.getVisible(scope, id);
    await this.db.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    return this.conversationToDto(await this.getVisible(scope, id));
  }
}
