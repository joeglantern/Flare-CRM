/**
 * PBX WebSocket subscriber (docs/06 §5): leader-locked single connection, heartbeat, backoff,
 * resubscribe and reconcile-on-connect.
 */
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { CallStateMachine } from './call-state.js';
import { SUBSCRIBED_TOPICS } from './events.js';
import { buildPbxTlsOptions } from './tls.js';
import type { TokenManager } from './token-manager.js';
import type { Redis } from 'ioredis';

export interface SubscriberDeps {
  valkey: Redis;
  tokens: TokenManager;
  machine: CallStateMachine;
  baseUrl: string;
  apiPath?: string;
  tls: { caFile?: string | undefined; fingerprintSha256?: string | undefined };
  log: {
    info: (o: unknown, m: string) => void;
    warn: (o: unknown, m: string) => void;
    error: (o: unknown, m: string) => void;
  };
  onStatus: (status: { connected: boolean }) => void;
  onConnected: () => Promise<void>;
}

const LEADER_KEY = 'cti:leader';
const LEADER_TTL_MS = 15_000;
const STATUS_KEY = 'cti:status';
const HEARTBEAT_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;

export class YeastarSubscriber {
  private readonly instanceId = randomUUID();
  private stopped = false;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private renewTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatDeadline: NodeJS.Timeout | null = null;
  private connectedSince: string | null = null;

  constructor(private readonly deps: SubscriberDeps) {}

  private shouldStop(): boolean {
    return this.stopped;
  }

  get isLeader(): boolean {
    return this.renewTimer !== null;
  }

  start(): void {
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    if (this.isLeader) await this.deps.valkey.del(LEADER_KEY).catch(() => undefined);
    await this.writeStatus(false);
  }

  private async loop(): Promise<void> {
    while (!this.shouldStop()) {
      const acquired = await this.deps.valkey.set(
        LEADER_KEY,
        this.instanceId,
        'PX',
        LEADER_TTL_MS,
        'NX',
      );
      if (acquired !== 'OK') {
        await sleep(5_000);
        continue;
      }
      this.renewTimer = setInterval(() => {
        this.deps.valkey
          .set(LEADER_KEY, this.instanceId, 'PX', LEADER_TTL_MS, 'XX')
          .catch((err: unknown) => {
            this.deps.log.error({ err }, 'leader lock renewal failed');
          });
      }, 5_000);
      this.renewTimer.unref();
      this.deps.log.info({ instanceId: this.instanceId }, 'CTI leader lock acquired');

      while (!this.shouldStop()) {
        try {
          await this.connectOnce();
        } catch (err) {
          this.deps.log.warn({ err }, 'PBX websocket session ended with error');
        }
        if (this.shouldStop()) break;
        this.attempt++;
        const backoff =
          Math.min(30_000, 1_000 * 2 ** Math.min(this.attempt, 5)) +
          Math.floor(Math.random() * 1_000);
        this.deps.log.info({ backoffMs: backoff, attempt: this.attempt }, 'reconnecting to PBX');
        await sleep(backoff);
      }
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve) => {
      void (async () => {
        const token = await this.deps.tokens.getAccessToken().catch((err: unknown) => {
          this.deps.log.error({ err }, 'cannot obtain PBX token for websocket');
          return null;
        });
        if (!token) {
          resolve();
          return;
        }
        const wsUrl = `${this.deps.baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}${this.deps.apiPath ?? '/openapi/v1.0'}/subscribe?access_token=${encodeURIComponent(token)}`;
        const tls = buildPbxTlsOptions(this.deps.tls);
        const ws = new WebSocket(wsUrl, {
          ...tls,
          handshakeTimeout: 10_000,
          headers: { 'User-Agent': 'OpenAPI' },
        });
        this.ws = ws;

        ws.on('open', () => {
          ws.send(JSON.stringify({ topic_list: [...SUBSCRIBED_TOPICS] }));
          this.attempt = 0;
          this.connectedSince = new Date().toISOString();
          this.startHeartbeat(ws);
          void this.writeStatus(true);
          this.deps.onStatus({ connected: true });
          this.deps.log.info({}, 'PBX websocket connected; topics subscribed');
          this.deps.onConnected().catch((err: unknown) => {
            this.deps.log.error({ err }, 'post-connect reconcile failed');
          });
        });

        ws.on('message', (data) => {
          const text = rawToString(data);
          this.armHeartbeatDeadline(ws, true);
          if (text === 'heartbeat response') return;
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            this.deps.log.warn({ text: text.slice(0, 200) }, 'non-JSON frame from PBX');
            return;
          }
          if (json && typeof json === 'object' && 'errcode' in json && !('type' in json)) {
            const errcode = (json as { errcode: number }).errcode;
            if (errcode !== 0) this.deps.log.error({ json }, 'PBX subscription error');
            return;
          }
          void this.deps.valkey.set(`${STATUS_KEY}:last_event_at`, new Date().toISOString());
          void this.deps.machine.handleRaw(json, 'websocket', new Date());
        });

        const finish = () => {
          this.clearHeartbeat();
          if (this.ws === ws) this.ws = null;
          void this.writeStatus(false);
          this.deps.onStatus({ connected: false });
          resolve();
        };
        ws.on('close', (code, reason) => {
          this.deps.log.warn({ code, reason: reason.toString() }, 'PBX websocket closed');
          finish();
        });
        ws.on('error', (err) => {
          this.deps.log.warn({ err }, 'PBX websocket error');
          finish();
        });
      })();
    });
  }

  private startHeartbeat(ws: WebSocket): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send('heartbeat');
      this.armHeartbeatDeadline(ws, false);
      void this.writeStatus(true); // keeps the status fresh for readCtiStatus staleness detection
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  private armHeartbeatDeadline(ws: WebSocket, clearOnly: boolean): void {
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
    this.heartbeatDeadline = null;
    if (clearOnly) return;
    this.heartbeatDeadline = setTimeout(() => {
      this.deps.log.warn({}, 'PBX heartbeat timed out; closing socket');
      ws.terminate();
    }, HEARTBEAT_TIMEOUT_MS);
    this.heartbeatDeadline.unref();
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
    this.heartbeatTimer = null;
    this.heartbeatDeadline = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = null;
  }

  private async writeStatus(connected: boolean): Promise<void> {
    await this.deps.valkey
      .set(
        STATUS_KEY,
        JSON.stringify({
          connected,
          since: connected ? this.connectedSince : null,
          leader: this.instanceId,
          updatedAt: new Date().toISOString(),
        }),
      )
      .catch(() => undefined);
  }
}

export async function readCtiStatus(valkey: Redis): Promise<{
  connected: boolean;
  since: string | null;
  leader: string | null;
  lastEventAt: string | null;
}> {
  const [raw, lastEventAt] = await Promise.all([
    valkey.get(STATUS_KEY),
    valkey.get(`${STATUS_KEY}:last_event_at`),
  ]);
  const parsed = raw
    ? (JSON.parse(raw) as {
        connected: boolean;
        since: string | null;
        leader: string | null;
        updatedAt: string;
      })
    : null;
  // a stale status (leader died without cleanup) counts as disconnected
  const fresh = parsed && Date.now() - Date.parse(parsed.updatedAt) < 2 * LEADER_TTL_MS + 60_000;
  return {
    connected: Boolean(parsed?.connected && fresh),
    since: parsed?.since ?? null,
    leader: parsed?.leader ?? null,
    lastEventAt,
  };
}

function rawToString(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
