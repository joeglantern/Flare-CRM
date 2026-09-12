/**
 * What this stack will tell the provider about itself (docs/21 §9).
 *
 * The console can ask, and nothing here changes anything. Every figure is about the installation
 * rather than the business running on it: which version is up, whether the schema is where the code
 * expects it, how long the background queues are, whether telephony and WhatsApp are switched on,
 * how many seats and channels and pipelines exist, how the bytes are divided, and what each of the
 * stack's own readiness checks says.
 *
 * Nothing in this file reads a contact, a call, a message or a deal, and no count here can identify
 * anybody. The checks come back with their detail, which the heartbeat's summary drops, because the
 * detail is the reason for asking rather than reading the last heartbeat.
 *
 * Audited in this customer's own log, naming the provider, exactly as the three support actions are:
 * being looked at is not the same as being left alone, and their administrator should be able to see
 * that it happened.
 */
import type { Diagnostics, DiagnosticsRequest } from '@crm/shared';
import type { QueueName } from '../../jobs/queues.js';
import type { AuditService } from '../../modules/audit/audit.service.js';
import type { EntitlementsService } from '../../modules/entitlements/entitlements.service.js';
import type { ReadinessRegistry } from '../../plugins/health.js';
import type { Db } from '../../plugins/prisma.js';
import type { Queues } from '../../plugins/queues.js';

/** The facts half of the answer, named so the gatherers below can each return their own piece. */
type Facts = NonNullable<Diagnostics['facts']>;

interface Logger {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}

export interface DiagnosticsDeps {
  db: Db;
  audit: AuditService;
  entitlements: EntitlementsService;
  readiness: ReadinessRegistry;
  queues: Queues;
  /** The queue names this deployment runs, so the answer lists what exists rather than a guess. */
  queueNames: readonly QueueName[];
  log: Logger;
  version: string;
  /** Switched on or off, and reachable or not. Never a credential, a host or a token. */
  telephony: () => { enabled: boolean; connected: boolean };
  whatsappEnabled: boolean;
}

/** One row of Prisma's own migration table, which is the only honest source for schema state. */
interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export async function runDiagnostics(
  deps: DiagnosticsDeps,
  request: DiagnosticsRequest,
): Promise<Diagnostics> {
  const [migrations, queues, usage, ready] = await Promise.all([
    readMigrations(deps),
    readQueues(deps),
    deps.entitlements.usage(),
    deps.readiness.run(),
  ]);

  const whatsappChannels = await deps.db.channel
    .count({ where: { type: 'whatsapp', isActive: true } })
    .catch(() => 0);

  const telephony = deps.telephony();

  await deps.audit.write(
    { actorId: null, actorType: 'system' },
    {
      action: 'support.diagnostics_read',
      entity: 'system',
      after: { provider: request.requestedBy },
    },
  );
  deps.log.info({ provider: request.requestedBy }, 'provider read diagnostics');

  return {
    commandId: request.commandId,
    ok: true,
    facts: {
      version: deps.version,
      uptimeSeconds: Math.round(process.uptime()),
      migrations,
      queues,
      integrations: {
        telephony,
        whatsapp: { enabled: deps.whatsappEnabled, channels: whatsappChannels },
      },
      counts: {
        channels: usage.channels.used,
        pipelines: usage.pipelines.used,
        seats: usage.seats.used,
      },
      storage: {
        usedBytes: usage.storage.usedBytes,
        attachmentsBytes: usage.storage.breakdown.attachments,
        recordingsBytes: usage.storage.breakdown.recordings,
        backupsBytes: usage.storage.breakdown.backups,
        refreshedAt: usage.storage.refreshedAt,
      },
      recordingRetentionDays: {
        configured: usage.recordingRetentionDays.configured,
        effective: usage.recordingRetentionDays.effective,
      },
      checks: checksOf(ready),
    },
  };
}

/**
 * Schema state, read from Prisma's own table.
 *
 * A row with no `finished_at` and no rollback is a migration that started and never completed, which
 * is the worst of the three states and the one worth a number of its own: the schema is halfway.
 * "Pending" here means exactly that rather than "a file on disk we have not run", because the stack
 * cannot see the console's migrations directory and should not pretend to.
 */
async function readMigrations(deps: DiagnosticsDeps): Promise<Facts['migrations']> {
  try {
    const rows = await deps.db.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY started_at DESC`;
    const applied = rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null);
    const newest = applied[0] ?? null;
    return {
      applied: applied.length,
      pending: rows.filter((r) => r.finished_at === null && r.rolled_back_at === null).length,
      failed: rows.filter((r) => r.rolled_back_at !== null).length,
      latest: newest?.migration_name ?? null,
      latestAppliedAt: newest?.finished_at?.toISOString() ?? null,
    };
  } catch (err: unknown) {
    // A stack that cannot read its own migration table is itself a fact, and a more interesting one
    // than a failed request: the answer says zero of everything rather than refusing outright.
    deps.log.warn({ err }, 'could not read the migration table for diagnostics');
    return { applied: 0, pending: 0, failed: 0, latest: null, latestAppliedAt: null };
  }
}

/** Each queue's backlog. A queue that cannot be reached is reported as zeroes, never omitted. */
async function readQueues(deps: DiagnosticsDeps): Promise<Facts['queues']> {
  return Promise.all(
    deps.queueNames.map(async (queue) => {
      try {
        const counts = await deps.queues
          .get(queue)
          .getJobCounts('waiting', 'active', 'delayed', 'failed');
        return {
          queue,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
        };
      } catch {
        return { queue, waiting: 0, active: 0, delayed: 0, failed: 0 };
      }
    }),
  );
}

/**
 * The readiness checks, with their detail carried through.
 *
 * A check's detail is written by the check itself and is about the installation, not its data, so it
 * travels as it is. Anything that is not an object is dropped rather than coerced: the contract says
 * a record, and a check returning a bare string is a bug to find at home, not a shape to invent here.
 */
function checksOf(ready: {
  checks: Record<string, { ok: boolean; detail?: unknown; error?: string }>;
}): Facts['checks'] {
  const out: Facts['checks'] = {};
  for (const [name, check] of Object.entries(ready.checks)) {
    out[name] = {
      ok: check.ok,
      ...(isRecord(check.detail) ? { detail: check.detail } : {}),
      ...(check.error === undefined ? {} : { error: check.error.slice(0, 300) }),
    };
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
