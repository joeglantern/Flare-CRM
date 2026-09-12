/**
 * The stack's end of the owner console link (docs/21).
 *
 * This process dials out; nothing ever reaches in. That is the point of the design: a customer's
 * server keeps its firewall shut, and the console learns how the stack is doing because the stack
 * tells it.
 *
 * One connection per deployment, not one per worker replica, so the replicas take a leader lock in
 * Valkey the same way the PBX subscriber does. Reconnection, backoff and jitter are Socket.IO's
 * job; the lock only decides who is holding the phone.
 *
 * Nothing about a customer's data goes over this link. What travels is: which version is running,
 * whether the stack considers itself healthy, how many seats and bytes are in use, when the last
 * backup was, and which entitlements document is in force.
 */
import { randomUUID } from 'node:crypto';
import { LINK_PROTOCOL, consoleToStackEvents, type StackToConsolePayload } from '@crm/shared';
import { runDiagnostics, type DiagnosticsDeps } from './diagnostics.js';
import { runSupportCommand, type SupportDeps } from './support.js';
import type { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import type { EntitlementsService } from '../../modules/entitlements/entitlements.service.js';
import { SYSTEM_AUDIT } from '../../modules/entitlements/entitlements.service.js';
import type { ReadinessRegistry } from '../../plugins/health.js';
import type { Storage } from '../storage/storage.js';

const LEADER_KEY = 'console:leader';
const LEADER_TTL_MS = 15_000;
const LEADER_RENEW_MS = 5_000;
const LEADER_RETRY_MS = 5_000;
const HEARTBEAT_MS = 30_000;

interface Logger {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
  error: (o: unknown, m: string) => void;
}

export interface ConsoleLinkDeps {
  valkey: Redis;
  entitlements: EntitlementsService;
  readiness: ReadinessRegistry;
  storage: Storage;
  log: Logger;
  config: {
    CONSOLE_URL: string;
    CONSOLE_STACK_ID: string;
    CONSOLE_STACK_SECRET: string;
    APP_URL: string;
    APP_VERSION: string;
  };
  /** Delivered to everyone signed in, and audited, by the caller. */
  onAnnounce: (message: { message: string; level: 'info' | 'warning' | 'error' }) => void;
  /**
   * What the provider is allowed to do to this stack when a customer asks for help. Absent means
   * the door is shut: a stack that was not given this refuses every command.
   */
  support?: SupportDeps;
  /**
   * What this stack will say about itself when the console asks. Absent means the door is shut, the
   * same as support: a stack that was not given this answers that it does not report diagnostics.
   */
  diagnostics?: DiagnosticsDeps;
}

export class ConsoleLink {
  private readonly instanceId = randomUUID();
  private stopped = false;
  private socket: Socket | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ConsoleLinkDeps) {}

  get isLeader(): boolean {
    return this.renewTimer !== null;
  }

  get connected(): boolean {
    return this.socket?.connected === true;
  }

  start(): void {
    void this.acquireThenConnect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    this.socket?.disconnect();
    this.socket = null;
    if (this.isLeader) await this.deps.valkey.del(LEADER_KEY).catch(() => undefined);
    await this.deps.entitlements
      .setLinkStatus({ connected: false, lastHeartbeatAt: null })
      .catch(() => undefined);
  }

  /** Waits for the lock, then holds the connection until this process stops. */
  private async acquireThenConnect(): Promise<void> {
    if (this.stopped) return;
    const acquired = await this.deps.valkey
      .set(LEADER_KEY, this.instanceId, 'PX', LEADER_TTL_MS, 'NX')
      .catch((err: unknown) => {
        this.deps.log.error({ err }, 'console leader lock failed');
        return null;
      });
    if (acquired !== 'OK') {
      this.retryTimer = setTimeout(() => {
        void this.acquireThenConnect();
      }, LEADER_RETRY_MS);
      this.retryTimer.unref();
      return;
    }

    this.renewTimer = setInterval(() => {
      this.deps.valkey
        .set(LEADER_KEY, this.instanceId, 'PX', LEADER_TTL_MS, 'XX')
        .catch((err: unknown) => {
          this.deps.log.error({ err }, 'console leader lock renewal failed');
        });
    }, LEADER_RENEW_MS);
    this.renewTimer.unref();
    this.deps.log.info({ instanceId: this.instanceId }, 'console leader lock acquired');
    this.connect();
  }

  private connect(): void {
    const { config, log } = this.deps;
    const socket = io(`${config.CONSOLE_URL}/link`, {
      transports: ['websocket'],
      auth: {
        stackId: config.CONSOLE_STACK_ID,
        secret: config.CONSOLE_STACK_SECRET,
        protocol: LINK_PROTOCOL,
      },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.4,
      timeout: 10_000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      void (async () => {
        log.info({ console: config.CONSOLE_URL }, 'console link connected');
        await this.say('hello', await this.hello());
        await this.writeStatus(true, null);
        await this.beat();
      })().catch((err: unknown) => {
        log.error({ err }, 'console hello failed');
      });
    });

    socket.on('disconnect', (reason: string) => {
      log.warn({ reason }, 'console link disconnected');
      void this.writeStatus(false, null).catch(() => undefined);
    });

    socket.on('connect_error', (err: Error) => {
      // Wrong credentials look exactly like a console that is down, so this is a warning, not an
      // error: the stack keeps running on the document it already has either way.
      log.warn({ err: err.message }, 'console link could not connect');
    });

    socket.on('entitlements', (raw: unknown) => {
      void this.onEntitlements(raw).catch((err: unknown) => {
        log.error({ err }, 'applying entitlements from the console failed');
      });
    });

    socket.on('announce', (raw: unknown) => {
      const parsed = consoleToStackEvents.announce.safeParse(raw);
      if (!parsed.success) return;
      this.deps.onAnnounce(parsed.data);
    });

    // The console asking for a heartbeat now rather than at the next tick.
    socket.on('ping', () => {
      void this.beat().catch((err: unknown) => {
        log.error({ err }, 'heartbeat on request failed');
      });
    });

    socket.on('command', (raw: unknown) => {
      void this.onCommand(raw).catch((err: unknown) => {
        log.error({ err }, 'a support command failed');
      });
    });

    socket.on('diagnose', (raw: unknown) => {
      void this.onDiagnose(raw).catch((err: unknown) => {
        log.error({ err }, 'a diagnostics request failed');
      });
    });

    this.heartbeatTimer = setInterval(() => {
      void this.beat().catch((err: unknown) => {
        log.error({ err }, 'console heartbeat failed');
      });
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  private async onEntitlements(raw: unknown): Promise<void> {
    const parsed = consoleToStackEvents.entitlements.safeParse(raw);
    if (!parsed.success) {
      this.deps.log.warn({ issues: parsed.error.issues }, 'console sent a malformed document');
      return;
    }
    const { envelope, issueId } = parsed.data;
    const outcome = await this.deps.entitlements.apply(envelope, {
      issueId,
      source: 'console',
      ctx: SYSTEM_AUDIT,
    });
    // Acknowledged either way: a console that never hears back cannot tell a rejection from a
    // stack that is offline, and the difference matters to whoever is watching the fleet.
    await this.say('ack', {
      issueId,
      appliedAt: new Date().toISOString(),
      result: outcome.result === 'applied' ? 'applied' : 'rejected',
      ...(outcome.result === 'rejected' ? { reason: outcome.reason } : {}),
    });
    if (outcome.result === 'applied') {
      this.deps.log.info({ issueId, plan: outcome.state.doc.plan.name }, 'entitlements applied');
    } else {
      this.deps.log.warn({ issueId, reason: outcome.reason }, 'entitlements rejected');
    }
  }

  /**
   * A support action from the provider. Three are allowed and the rest are refused out of hand;
   * the answer always goes back, because a console that hears nothing cannot tell a refusal from a
   * stack that has gone away.
   */
  private async onCommand(raw: unknown): Promise<void> {
    const parsed = consoleToStackEvents.command.safeParse(raw);
    if (!parsed.success) {
      this.deps.log.warn({ issues: parsed.error.issues }, 'console sent a malformed command');
      return;
    }
    const command = parsed.data;
    const support = this.deps.support;
    if (support === undefined) {
      await this.say('commandResult', {
        commandId: command.commandId,
        action: command.action,
        ok: false,
        message: 'This stack does not accept support commands.',
      });
      return;
    }
    const result = await runSupportCommand(support, command);
    await this.say('commandResult', result);
  }

  /**
   * The console asking how this installation is doing. It changes nothing here, and the answer is
   * counts and states about the stack itself rather than anything belonging to the business.
   *
   * Answered either way, for the same reason a support command is: a console that hears nothing
   * cannot tell a stack that refuses from one that has gone away.
   */
  private async onDiagnose(raw: unknown): Promise<void> {
    const parsed = consoleToStackEvents.diagnose.safeParse(raw);
    if (!parsed.success) {
      this.deps.log.warn(
        { issues: parsed.error.issues },
        'console sent a malformed diagnostics request',
      );
      return;
    }
    const request = parsed.data;
    const diagnostics = this.deps.diagnostics;
    if (diagnostics === undefined) {
      await this.say('diagnosticsResult', {
        commandId: request.commandId,
        ok: false,
        message: 'This stack does not report diagnostics.',
      });
      return;
    }
    await this.say('diagnosticsResult', await runDiagnostics(diagnostics, request));
  }

  private async hello(): Promise<StackToConsolePayload<'hello'>> {
    const state = await this.deps.entitlements.getState();
    return {
      stackId: this.deps.config.CONSOLE_STACK_ID,
      protocol: LINK_PROTOCOL,
      version: this.deps.config.APP_VERSION,
      domain: hostOf(this.deps.config.APP_URL),
      startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
      entitlements: {
        issueId: state.issueId,
        issuedAt: state.doc.issuedAt,
        keyId: state.keyId,
      },
    };
  }

  private async beat(): Promise<void> {
    if (!this.connected) return;
    const [ready, usage, state, lastBackupAt] = await Promise.all([
      this.deps.readiness.run(),
      this.deps.entitlements.usage(),
      this.deps.entitlements.getState(),
      this.lastBackupAt(),
    ]);
    const at = new Date().toISOString();
    const payload: StackToConsolePayload<'heartbeat'> = {
      at,
      version: this.deps.config.APP_VERSION,
      ready: {
        ok: ready.ok,
        checks: Object.fromEntries(
          Object.entries(ready.checks).map(([name, check]) => [
            name,
            check.error === undefined ? { ok: check.ok } : { ok: check.ok, error: check.error },
          ]),
        ),
      },
      usage: {
        seatsActive: usage.seats.used,
        storageBytes: usage.storage.usedBytes,
        attachmentsBytes: usage.storage.breakdown.attachments,
        recordingsBytes: usage.storage.breakdown.recordings,
        backupsBytes: usage.storage.breakdown.backups,
      },
      lastBackupAt,
      entitlements: { issueId: state.issueId, issuedAt: state.doc.issuedAt, keyId: state.keyId },
    };
    await this.say('heartbeat', payload);
    await this.writeStatus(true, at);
  }

  /** The newest object under the backups prefix, which is what a backup having run looks like. */
  private async lastBackupAt(): Promise<string | null> {
    try {
      const objects = await this.deps.storage.list('backups/', 1000);
      if (objects.length === 0) return null;
      const newest = objects.reduce((a, b) => (a.lastModified > b.lastModified ? a : b));
      return newest.lastModified;
    } catch {
      return null;
    }
  }

  private say(
    event: 'hello' | 'heartbeat' | 'ack' | 'commandResult' | 'diagnosticsResult',
    payload: unknown,
  ): Promise<void> {
    this.socket?.emit(event, payload);
    return Promise.resolve();
  }

  private async writeStatus(connected: boolean, lastHeartbeatAt: string | null): Promise<void> {
    await this.deps.entitlements
      .setLinkStatus({ connected, lastHeartbeatAt })
      .catch((err: unknown) => {
        this.deps.log.error({ err }, 'writing the console link status failed');
      });
  }

  private clearTimers(): void {
    for (const timer of [this.renewTimer, this.heartbeatTimer, this.retryTimer]) {
      if (timer) clearInterval(timer);
    }
    this.renewTimer = null;
    this.heartbeatTimer = null;
    this.retryTimer = null;
  }
}

/** The console wants the hostname a customer types, not the whole URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
