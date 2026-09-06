# 11 — Chat Integration (Phase 2 design, built on Phase 1 data model)

Spec §5 requires at least one 2-way chat channel logged in the unified timeline. The channel
is **CONFIRM WITH CLIENT**; the default assumption is **WhatsApp Business (Meta Cloud API)**.
The design isolates providers behind one adapter interface so adding SMS, Yeastar's own
omnichannel messaging, or a website live-chat widget is additive.

## 1. Adapter interface (`modules/messaging/adapters/channel-adapter.ts`)

```ts
export interface ChannelAdapter {
  readonly type: ChannelType; // 'whatsapp' | 'sms' | 'livechat' | 'yeastar'
  verifyWebhook(req: RawRequest): Promise<boolean>; // signature / token check on raw body
  parseInbound(payload: unknown): InboundEvent[]; // → normalized messages/status updates
  send(msg: OutboundMessage, channel: Channel): Promise<{ externalMessageId: string }>;
  downloadMedia(ref: MediaRef, channel: Channel): Promise<ReadableStream>; // to S3
  capabilities(): {
    text: true;
    media: boolean;
    templates: boolean;
    readReceipts: boolean;
    sessionWindowHours?: number;
  };
}

type InboundEvent =
  | {
      kind: 'message';
      externalId: string;
      from: string /* E.164 or channel id */;
      to: string;
      sentAt: Date;
      contentType: MessageContentType;
      body?: string;
      media?: MediaRef[];
      raw: unknown;
      profileName?: string;
    }
  | {
      kind: 'status';
      externalId: string;
      status: 'sent' | 'delivered' | 'read' | 'failed';
      at: Date;
      error?: { code: string; message: string };
    };
```

Normalized flow (identical for every adapter):

```
webhook → adapter.verifyWebhook → adapter.parseInbound → enqueue messaging.inbound (jobId = channelId:externalId)
worker → upsert Conversation (channel_id, external_id) → resolve Contact by E.164/email → insert Message (unique externalId)
       → media → S3 attachments → Activity(message) → conversation.unread_count++ → socket message:new → Notification(message_new)
agent reply → POST /conversations/:id/messages → insert Message(status=queued) → enqueue messaging.outbound
worker → adapter.send → Message.externalMessageId, status=sent → status webhooks update delivered/read/failed → socket message:status
```

Unknown senders: a conversation is created with `contact_id = null`; the inbox shows "Unknown +254…" with a _create/link contact_ action (same as unknown callers). Linking back-fills `contact_id` on the conversation and its Activity rows.

## 2. WhatsApp Business Cloud API adapter (default)

- Prereqs (client): Meta Business, WhatsApp Business Account, a phone number registered on the Cloud API, a Meta app with `whatsapp_business_messaging` permission, permanent **System User token**, **App Secret**, and a verify token we generate.
- Webhook: `GET /webhooks/whatsapp` handles the verification handshake (`hub.mode=subscribe`, `hub.verify_token` must equal `WHATSAPP_VERIFY_TOKEN`, respond with `hub.challenge`). `POST /webhooks/whatsapp` verifies `X-Hub-Signature-256` (`sha256=` + hex HMAC-SHA256 of the raw body with `WHATSAPP_APP_SECRET`, `timingSafeEqual`), then enqueues and returns `200`.
- Payload parsing: `entry[].changes[].value.messages[]` (types: text, image, audio, video, document, sticker, location, contacts, interactive, button, reaction, unsupported) and `value.statuses[]` (sent/delivered/read/failed with `errors[]`). `contacts[].profile.name` → `profileName`. `wa_id` is the customer's E.164 without `+` → normalize to `+`.
- Sending: `POST https://graph.facebook.com/v23.0/{phone_number_id}/messages` with `{ messaging_product: 'whatsapp', to, type: 'text', text: { body } }` (or `image/document` with uploaded media id, or `template` outside the 24-hour customer-service window). Adapter enforces the **24 h window**: if `now - conversation.last_inbound_at > 24 h`, free-text send is rejected with `409 TEMPLATE_REQUIRED` and the UI offers approved templates.
- Media: inbound media ids are resolved via `GET /{media_id}` → URL → download with the bearer token → S3. Never store Meta's temporary URLs.
- Rate/quality: respect `429`/`131056` pair-rate errors with backoff; messaging tier limits are the client's account concern.
- Secrets: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` in env; `phone_number_id` and `waba_id` in `channels.config`.

## 3. Yeastar messaging adapter (alternative)

If the client already runs WhatsApp/SMS through the Yeastar P-Series omnichannel feature, we can consume it without a Meta app:

- Events: `30031` New Message Notification (`session_id`, `msg_id`, `sender { user_no, user_type: 2=SMS,3=WhatsApp,4=Facebook,5=Live Chat }`, `msg_type`, `msg_body`, `msg_files` JSON, `send_time`), `30032` Message Sending Result (`delivery_status`), `30038` Read Receipt.
- Send: `POST /message/send` (session or new session by number/channel).
- Sessions map to `conversations.external_id = session_id`; message ids to `external_message_id = msg_id`.
- Requires the PBX messaging subscription and the same Open API token as CTI (worker already subscribed; just add topics).
- Trade-off: ties chat availability to the PBX plan; message history lives in two places. Prefer the direct Meta adapter unless the client insists on PBX-centric messaging.

## 4. SMS adapter (optional)

Any HTTP SMS gateway (e.g. Africa's Talking, Twilio) implements the same interface; inbound via provider webhook with its signature scheme; outbound via provider REST. Numbers already E.164 → contact matching is identical.

## 5. Website live chat (optional, P3)

A tiny embeddable widget (`packages/widget`) talks to `/public/livechat` with a per-site token; visitor identity is a cookie id until they share phone/email; then the conversation is linked to a contact. Same adapter interface (`type: 'livechat'`), transport is Socket.IO namespace `/livechat` with its own auth.

## 6. Inbox behavior rules

- Conversations have an `assignee`; unassigned inbound messages notify the team (`team:{id}` room) and managers; first agent to reply auto-assigns (configurable).
- `unread_count` resets when the assignee opens the conversation (`conv:join` + `POST /conversations/:id/read`).
- Closing a conversation does not delete history; a new inbound reopens it.
- Attachments are scanned by MIME sniffing and size-limited (16 MiB WhatsApp cap); executables rejected.
- Retention: `messages.raw` purged after `Setting.retention.rawMessagePayloadDays`; bodies/attachments kept per policy.
