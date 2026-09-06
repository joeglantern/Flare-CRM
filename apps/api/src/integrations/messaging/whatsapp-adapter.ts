/**
 * WhatsApp Business Cloud API adapter (docs/11 §2).
 * Webhook: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(rawBody, appSecret)).
 * Send: POST /{version}/{phone_number_id}/messages. Media: upload → id → send; inbound media id → URL → bytes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { MessageContentType } from '@crm/shared';
import {
  ChannelSendError,
  type ChannelAdapter,
  type ChannelContext,
  type InboundEvent,
  type InboundMedia,
  type OutboundMessage,
} from './channel-adapter.js';

export interface WhatsAppAdapterOptions {
  apiBaseUrl: string; // https://graph.facebook.com
  graphVersion: string; // v23.0
  appSecret: string | undefined;
  defaultAccessToken: string | undefined;
  timeoutMs?: number;
}

const wamessage = z
  .object({
    id: z.string(),
    from: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    image: z
      .object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional() })
      .optional(),
    video: z
      .object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional() })
      .optional(),
    audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
    document: z
      .object({
        id: z.string(),
        mime_type: z.string().optional(),
        filename: z.string().optional(),
        caption: z.string().optional(),
      })
      .optional(),
    sticker: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .optional(),
    button: z.object({ text: z.string() }).optional(),
    interactive: z
      .object({
        button_reply: z.object({ title: z.string() }).optional(),
        list_reply: z.object({ title: z.string() }).optional(),
      })
      .optional(),
    reaction: z
      .object({ emoji: z.string().optional(), message_id: z.string().optional() })
      .optional(),
    contacts: z.array(z.unknown()).optional(),
  })
  .loose();

const wastatus = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string(),
    errors: z
      .array(
        z
          .object({
            code: z.coerce.string(),
            title: z.string().optional(),
            message: z.string().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const webhookPayload = z.object({
  object: z.string().optional(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string().optional(),
          value: z
            .object({
              metadata: z
                .object({
                  phone_number_id: z.string().optional(),
                  display_phone_number: z.string().optional(),
                })
                .optional(),
              contacts: z
                .array(
                  z.object({
                    wa_id: z.string().optional(),
                    profile: z.object({ name: z.string().optional() }).optional(),
                  }),
                )
                .optional(),
              messages: z.array(wamessage).optional(),
              statuses: z.array(wastatus).optional(),
            })
            .loose(),
        }),
      ),
    }),
  ),
});

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = 'whatsapp' as const;
  private readonly timeoutMs: number;

  constructor(private readonly opts: WhatsAppAdapterOptions) {
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  capabilities() {
    return { media: true, templates: true, readReceipts: true, replyWindowHours: 24 };
  }

  addressFor(e164: string): string {
    return e164.replace(/^\+/, '');
  }

  e164For(address: string): string | null {
    return /^\d{6,15}$/.test(address) ? `+${address}` : null;
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    if (!this.opts.appSecret) return false;
    const header = headers['x-hub-signature-256'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value?.startsWith('sha256=')) return false;
    const expected = Buffer.from(
      `sha256=${createHmac('sha256', this.opts.appSecret).update(rawBody).digest('hex')}`,
      'utf8',
    );
    const provided = Buffer.from(value, 'utf8');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  parseInbound(payload: unknown): { channelExternalId: string | null; events: InboundEvent[] }[] {
    const parsed = webhookPayload.safeParse(payload);
    if (!parsed.success) return [];
    const out: { channelExternalId: string | null; events: InboundEvent[] }[] = [];
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        const v = change.value;
        const events: InboundEvent[] = [];
        const names = new Map((v.contacts ?? []).map((c) => [c.wa_id ?? '', c.profile?.name]));
        for (const m of v.messages ?? []) {
          const sentAt = new Date(Number(m.timestamp) * 1000);
          let contentType: MessageContentType = 'text';
          let body: string | undefined;
          const media: InboundMedia[] = [];
          switch (m.type) {
            case 'text':
              body = m.text?.body;
              break;
            case 'image':
              contentType = 'image';
              body = m.image?.caption;
              if (m.image)
                media.push({
                  providerMediaId: m.image.id,
                  mimeType: m.image.mime_type,
                  fileName: undefined,
                  caption: m.image.caption,
                });
              break;
            case 'video':
              contentType = 'video';
              body = m.video?.caption;
              if (m.video)
                media.push({
                  providerMediaId: m.video.id,
                  mimeType: m.video.mime_type,
                  fileName: undefined,
                  caption: m.video.caption,
                });
              break;
            case 'audio':
              contentType = 'audio';
              if (m.audio)
                media.push({
                  providerMediaId: m.audio.id,
                  mimeType: m.audio.mime_type,
                  fileName: undefined,
                  caption: undefined,
                });
              break;
            case 'document':
              contentType = 'document';
              body = m.document?.caption;
              if (m.document)
                media.push({
                  providerMediaId: m.document.id,
                  mimeType: m.document.mime_type,
                  fileName: m.document.filename,
                  caption: m.document.caption,
                });
              break;
            case 'sticker':
              contentType = 'image';
              if (m.sticker)
                media.push({
                  providerMediaId: m.sticker.id,
                  mimeType: m.sticker.mime_type,
                  fileName: undefined,
                  caption: undefined,
                });
              break;
            case 'location':
              contentType = 'location';
              body = m.location
                ? `${m.location.name ?? ''} ${m.location.address ?? ''} (${String(m.location.latitude)}, ${String(m.location.longitude)})`.trim()
                : undefined;
              break;
            case 'button':
              body = m.button?.text;
              break;
            case 'interactive':
              body = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
              break;
            case 'reaction':
              body = m.reaction?.emoji ? `Reacted ${m.reaction.emoji}` : undefined;
              break;
            default:
              contentType = 'unsupported';
          }
          events.push({
            kind: 'message',
            externalId: m.id,
            from: m.from,
            to: v.metadata?.display_phone_number ?? '',
            sentAt,
            contentType,
            body,
            media,
            profileName: names.get(m.from),
            raw: m,
          });
        }
        for (const s of v.statuses ?? []) {
          const status =
            s.status === 'sent' ||
            s.status === 'delivered' ||
            s.status === 'read' ||
            s.status === 'failed'
              ? s.status
              : null;
          if (!status) continue;
          const err = s.errors?.[0];
          events.push({
            kind: 'status',
            externalId: s.id,
            status,
            at: new Date(Number(s.timestamp) * 1000),
            error: err
              ? { code: err.code, message: err.message ?? err.title ?? 'Delivery failed' }
              : undefined,
          });
        }
        out.push({ channelExternalId: v.metadata?.phone_number_id ?? null, events });
      }
    }
    return out;
  }

  private token(channel: ChannelContext): string {
    const token = channel.secrets.accessToken ?? this.opts.defaultAccessToken;
    if (!token)
      throw new ChannelSendError('NO_TOKEN', 'WhatsApp access token is not configured', false);
    return token;
  }

  private url(path: string): string {
    return `${this.opts.apiBaseUrl.replace(/\/+$/, '')}/${this.opts.graphVersion}/${path}`;
  }

  private async graph<T>(
    channel: ChannelContext,
    method: 'GET' | 'POST',
    path: string,
    body?: string | FormData,
    contentType?: string,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: {
          Authorization: `Bearer ${this.token(channel)}`,
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ChannelSendError(
        'NETWORK',
        `WhatsApp request failed: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code?: number; message?: string; error_subcode?: number };
    } & T;
    if (!res.ok || json.error) {
      const code = String(json.error?.code ?? res.status);
      const retryable =
        res.status === 429 || res.status >= 500 || code === '130429' || code === '131056';
      throw new ChannelSendError(
        code,
        json.error?.message ?? `WhatsApp returned HTTP ${String(res.status)}`,
        retryable,
      );
    }
    return json;
  }

  async send(
    channel: ChannelContext,
    message: OutboundMessage,
  ): Promise<{ externalMessageId: string }> {
    const phoneId = channel.externalId;
    if (!phoneId)
      throw new ChannelSendError('NO_PHONE_ID', 'Channel has no phone_number_id', false);
    let payload: Record<string, unknown>;
    if (message.template) {
      payload = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'template',
        template: {
          name: message.template.name,
          language: { code: message.template.language },
          ...(message.template.params.length > 0
            ? {
                components: [
                  {
                    type: 'body',
                    parameters: message.template.params.map((text) => ({ type: 'text', text })),
                  },
                ],
              }
            : {}),
        },
      };
    } else if (message.media) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', message.media.mimeType);
      form.append(
        'file',
        new Blob([new Uint8Array(message.media.buffer)], { type: message.media.mimeType }),
        message.media.fileName,
      );
      const uploaded = await this.graph<{ id: string }>(channel, 'POST', `${phoneId}/media`, form);
      const kind = message.media.mimeType.startsWith('image/')
        ? 'image'
        : message.media.mimeType.startsWith('video/')
          ? 'video'
          : message.media.mimeType.startsWith('audio/')
            ? 'audio'
            : 'document';
      payload = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: kind,
        [kind]: {
          id: uploaded.id,
          ...(message.media.caption && kind !== 'audio' ? { caption: message.media.caption } : {}),
          ...(kind === 'document' ? { filename: message.media.fileName } : {}),
        },
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'text',
        text: { body: message.body ?? '', preview_url: false },
      };
    }
    const res = await this.graph<{ messages?: { id: string }[] }>(
      channel,
      'POST',
      `${phoneId}/messages`,
      JSON.stringify(payload),
      'application/json',
    );
    const id = res.messages?.[0]?.id;
    if (!id)
      throw new ChannelSendError('NO_MESSAGE_ID', 'WhatsApp did not return a message id', false);
    return { externalMessageId: id };
  }

  async downloadMedia(
    channel: ChannelContext,
    providerMediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string | undefined }> {
    const meta = await this.graph<{ url: string; mime_type?: string; file_size?: number }>(
      channel,
      'GET',
      providerMediaId,
    );
    if (!meta.url.startsWith('https://') && !meta.url.startsWith(this.opts.apiBaseUrl))
      throw new ChannelSendError('BAD_MEDIA_URL', 'Refusing non-https media URL', false);
    const res = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${this.token(channel)}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok)
      throw new ChannelSendError(
        'MEDIA_DOWNLOAD',
        `Media download returned HTTP ${String(res.status)}`,
        true,
      );
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      buffer,
      mimeType: meta.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream',
      fileName: undefined,
    };
  }
}
