# 10 — Realtime Contract (Socket.IO)

## 1. Server setup

- Socket.IO 4 server created in `plugins/socket.ts`: `new Server(fastify.server, { path: '/socket.io', transports: ['websocket'], serveClient: false, cors: { origin: env.APP_URL, credentials: true }, maxHttpBufferSize: 64 * 1024, pingInterval: 25000, pingTimeout: 20000 })`.
- Production uses **WebSocket-only** transport (no long-polling) → no sticky sessions needed across replicas; Caddy proxies upgrades natively.
- Adapter: `@socket.io/redis-adapter` over Valkey (pub/sub) so any `api` replica can emit to any room; the **worker** emits with `@socket.io/redis-emitter` (same Valkey, same key prefix `socket.io`).
- Namespace: single default namespace `/`. Rooms carry authorization.

## 2. Handshake authentication

1. Browser connects with cookies (same origin, `withCredentials: true`).
2. `io.use(async (socket, next))` → `auth.api.getSession({ headers: socket.handshake.headers })`.
3. No session / inactive / banned → `next(new Error('UNAUTHENTICATED'))` (client redirects to login).
4. On success: `socket.data = { userId, role, teamId, extension }` and joins rooms:
   - `user:{userId}` — personal events
   - `ext:{extension}` — (if set) extension-targeted events
   - `team:{teamId}` — team broadcasts
   - `role:manager` / `role:admin` — supervisory feeds
   - `all` — system announcements
5. Every 30 s the server re-validates the session token (cached lookup); revoked → `socket.disconnect(true)`.
6. Max 3 sockets per user (extra connections are rejected with `TOO_MANY_CONNECTIONS`).

## 3. Server → client events

Payloads are Zod schemas in `packages/shared/socket-events.ts` (single source for both sides). All payloads include `at` (ISO timestamp) and, for call events, `pbxCallId` and `callId` (CRM uuid, may be null before the row exists).

| Event                                       | Room                                                             | Payload (summary)                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `call:ringing`                              | `user:{id}` of each ringing agent                                | `{ callId, pbxCallId, direction, callerNumber (E.164 or null), callerDisplay, trunkName, didNumber, callPath, contact: { id, displayName, company: {id,name}?, avatarUrl?, ownerId?, doNotCall } \| null, matchCandidates: [{id, displayName}] , recentActivity: Activity[≤5], restricted: boolean, capabilities: { answer, decline, hangup, hold, mute, transfer } }` |
| `call:answered`                             | popped users                                                     | `{ callId, pbxCallId, answeredByUserId, answeredByExtension, answeredAt }`                                                                                                                                                                                                                                                                                             |
| `call:cancelled`                            | popped users except answerer                                     | `{ callId, pbxCallId, reason: 'answered_elsewhere'\|'caller_hung_up'\|'timeout' }`                                                                                                                                                                                                                                                                                     |
| `call:updated`                              | participants                                                     | `{ callId, hold?: boolean, muted?: boolean, transferredTo?: string }`                                                                                                                                                                                                                                                                                                  |
| `call:ended`                                | participants                                                     | `{ callId, pbxCallId, endedAt }`                                                                                                                                                                                                                                                                                                                                       |
| `call:logged`                               | participants + record owner                                      | `{ callId, status, talkDurationSec, totalDurationSec, contactId, suggestFollowUp: boolean, recordingStatus }`                                                                                                                                                                                                                                                          |
| `call:recording`                            | owner/participants                                               | `{ callId, recordingStatus }` (stored/failed)                                                                                                                                                                                                                                                                                                                          |
| `call:dialing`                              | dialing user                                                     | `{ callId, pbxCallId, callee }` (mirrors HTTP 202 for other tabs)                                                                                                                                                                                                                                                                                                      |
| `live-calls:snapshot` / `live-calls:update` | `role:manager`, `role:admin`                                     | wallboard: `[{ pbxCallId, direction, external, extension, userName, status, since }]`                                                                                                                                                                                                                                                                                  |
| `agent:presence`                            | `role:manager`, `role:admin`                                     | `{ userId, extension, registered: boolean, callState: 'idle'\|'ringing'\|'busy' }`                                                                                                                                                                                                                                                                                     |
| `pbx:status`                                | `role:admin` (+ `all` when disconnected > 2 min)                 | `{ connected: boolean, since, lastEventAt }`                                                                                                                                                                                                                                                                                                                           |
| `message:new`                               | `user:{assignee}` or `team:{id}` when unassigned; `all` managers | `{ conversationId, messageId, channelType, contact, preview, direction }`                                                                                                                                                                                                                                                                                              |
| `message:status`                            | conversation viewers (`conv:{id}` room)                          | `{ messageId, status, errorMessage? }`                                                                                                                                                                                                                                                                                                                                 |
| `conversation:updated`                      | `conv:{id}` + assignee                                           | `{ conversationId, status, assigneeId, unreadCount }`                                                                                                                                                                                                                                                                                                                  |
| `notification:new`                          | `user:{id}`                                                      | `Notification` row                                                                                                                                                                                                                                                                                                                                                     |
| `task:reminder`                             | `user:{assignee}`                                                | `{ taskId, title, dueAt }`                                                                                                                                                                                                                                                                                                                                             |
| `deal:stage`                                | owner + `team:{id}`                                              | `{ dealId, title, fromStage, toStage, byUserId }`                                                                                                                                                                                                                                                                                                                      |
| `entity:changed`                            | viewers (`entity:{type}:{id}` room)                              | `{ type, id, updatedAt, byUserId }` — lets open forms warn about concurrent edits                                                                                                                                                                                                                                                                                      |
| `system:announce`                           | `all`                                                            | `{ level, message }`                                                                                                                                                                                                                                                                                                                                                   |

## 4. Client → server events

| Event                             | Payload              | Effect                                        |
| --------------------------------- | -------------------- | --------------------------------------------- |
| `conv:join` / `conv:leave`        | `{ conversationId }` | joins `conv:{id}` after permission check      |
| `entity:watch` / `entity:unwatch` | `{ type, id }`       | joins `entity:{type}:{id}` after scope check  |
| `presence:ping`                   | —                    | updates `users.last_seen_at` (throttled 60 s) |

Everything else (dial, control, disposition, sending messages) goes through **HTTP** so it is validated, audited and idempotent. Sockets are for push only. Unknown events are ignored and rate-counted (20 events/s/socket cap → disconnect).

## 5. Delivery guarantees

- Socket events are **best-effort**. Anything that must not be lost also exists as a DB row (`calls`, `notifications`, `messages`); the SPA reconciles on reconnect by fetching `GET /calls?status=ringing,answered&mine=true` and `GET /notifications?unread=true`.
- Client reconnect: exponential backoff (socket.io default), on `connect` it re-joins conversation/entity rooms it was watching.
- Events for one `pbxCallId` are emitted in order (worker processes per-call sequentially).

## 6. Worker emission

```ts
const emitter = new Emitter(valkeyPub); // @socket.io/redis-emitter
emitter.to(`user:${userId}`).emit('call:ringing', payload);
```

The emitter validates payloads against the shared Zod schema in dev/test (`assertEvent()`), stripped in prod for latency.
