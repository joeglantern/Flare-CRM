/**
 * Channel adapter contract (docs/11 §1). Every provider normalizes to these shapes; the
 * messaging service never sees provider payloads.
 */
import type { ChannelType, MessageContentType } from '@crm/shared';

export interface ChannelContext {
  id: string;
  type: ChannelType;
  externalId: string | null;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

export interface InboundMedia {
  providerMediaId: string;
  mimeType: string | undefined;
  fileName: string | undefined;
  caption: string | undefined;
}

export type InboundEvent =
  | {
      kind: 'message';
      externalId: string;
      /** Customer identifier on the channel (E.164 without '+' for WhatsApp). */
      from: string;
      to: string;
      sentAt: Date;
      contentType: MessageContentType;
      body: string | undefined;
      media: InboundMedia[];
      profileName: string | undefined;
      raw: unknown;
    }
  | {
      kind: 'status';
      externalId: string;
      status: 'sent' | 'delivered' | 'read' | 'failed';
      at: Date;
      error: { code: string; message: string } | undefined;
    };

export interface OutboundMessage {
  to: string;
  body?: string | undefined;
  media?:
    | { buffer: Buffer; mimeType: string; fileName: string; caption?: string | undefined }
    | undefined;
  template?: { name: string; language: string; params: string[] } | undefined;
}

export interface ChannelAdapter {
  readonly type: ChannelType;
  /** Provider webhook signature check on the raw request body. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  /** Returns the provider-side channel id the payload belongs to, plus normalized events. */
  parseInbound(payload: unknown): { channelExternalId: string | null; events: InboundEvent[] }[];
  send(channel: ChannelContext, message: OutboundMessage): Promise<{ externalMessageId: string }>;
  downloadMedia(
    channel: ChannelContext,
    providerMediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string | undefined }>;
  capabilities(): {
    media: boolean;
    templates: boolean;
    readReceipts: boolean;
    replyWindowHours: number | null;
  };
  /** Convert an E.164 number into the provider's addressing format. */
  addressFor(e164: string): string;
  /** Convert a provider address back into E.164 (or null when it is not a phone number). */
  e164For(address: string): string | null;
}

export class ChannelSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ChannelSendError';
  }
}
