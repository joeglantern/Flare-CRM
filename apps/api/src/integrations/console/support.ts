/**
 * What this stack will let the provider do to it, and nothing else (docs/21 §9).
 *
 * The owner console can ask three things: who can sign in here, clear one person's second factor,
 * and end one person's sessions. That list is closed. Nothing here reads a contact, a call, a
 * message or a deal, and no action can create an account or change what anybody may do.
 *
 * Every one of them writes an audit row in this customer's own log, naming the provider and the
 * person who asked, so their administrator can see exactly what was done and when. Support that
 * cannot be seen afterwards is not support, it is access.
 */
import type { Redis } from 'ioredis';
import {
  SUPPORT_ACTIONS,
  type SupportCommand,
  type SupportResult,
  type SupportUser,
} from '@crm/shared';
import type { AuditService } from '../../modules/audit/audit.service.js';
import { twoFactorReset } from '../../modules/notifications/templates/auth.js';
import type { Mailer } from '../../plugins/mailer.js';
import type { Db } from '../../plugins/prisma.js';

/** Better Auth keeps a list of live sessions per user under this key, and each session under its token. */
const SESSION_LIST_PREFIX = 'auth:active-sessions-';
const SESSION_PREFIX = 'auth:';

interface Logger {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}

export interface SupportDeps {
  db: Db;
  valkey: Redis;
  audit: AuditService;
  log: Logger;
  /** So the person a support action happened to hears it from us, and not from a broken sign-in. */
  mailer?: Mailer;
  appUrl?: string;
}

export async function runSupportCommand(
  deps: SupportDeps,
  command: SupportCommand,
): Promise<SupportResult> {
  if (!SUPPORT_ACTIONS.includes(command.action)) {
    return {
      commandId: command.commandId,
      action: command.action,
      ok: false,
      message: 'Unknown action',
    };
  }

  const context = { actorId: null, actorType: 'system' as const };
  const provider = command.requestedBy;

  if (command.action === 'list-users') {
    // Users are not soft deleted in this schema; deactivated ones still matter to support, and
    // the flag is returned so the console can see who is switched off.
    const rows = await deps.db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        twoFactorEnabled: true,
        lastSeenAt: true,
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
    const users: SupportUser[] = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role ?? 'agent',
      isActive: u.isActive,
      twoFactorEnabled: u.twoFactorEnabled === true,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    }));
    await deps.audit.write(context, {
      action: 'support.users_listed',
      entity: 'system',
      after: { provider, reason: command.reason ?? null, users: users.length },
    });
    deps.log.info({ provider, users: users.length }, 'provider listed users for support');
    return { commandId: command.commandId, action: command.action, ok: true, users };
  }

  const email = command.email;
  if (email === undefined) {
    return {
      commandId: command.commandId,
      action: command.action,
      ok: false,
      message: 'That action needs an email address',
    };
  }
  const user = await deps.db.user.findFirst({
    where: { email },
    select: { id: true, name: true, email: true, twoFactorEnabled: true },
  });
  if (!user) {
    return {
      commandId: command.commandId,
      action: command.action,
      ok: false,
      message: 'Nobody here uses that email address',
    };
  }

  if (command.action === 'reset-two-factor') {
    await deps.db.$transaction(async (tx) => {
      await tx.twoFactor.deleteMany({ where: { userId: user.id } });
      await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
      await deps.audit.writeWith(tx, context, {
        action: 'support.two_factor_reset',
        entity: 'user',
        entityId: user.id,
        before: { twoFactorEnabled: user.twoFactorEnabled },
        after: { twoFactorEnabled: false, provider, reason: command.reason ?? null },
      });
    });
    await endSessions(deps, user.id);
    await tellThem(deps, user, provider, command.reason ?? null);
    deps.log.warn({ provider, userId: user.id }, 'provider reset a second factor');
    return {
      commandId: command.commandId,
      action: command.action,
      ok: true,
      message: `${user.name} can set up an authenticator again at their next sign-in.`,
    };
  }

  await endSessions(deps, user.id);
  await deps.audit.write(context, {
    action: 'support.sessions_revoked',
    entity: 'user',
    entityId: user.id,
    after: { provider, reason: command.reason ?? null },
  });
  deps.log.warn({ provider, userId: user.id }, 'provider ended a person’s sessions');
  return {
    commandId: command.commandId,
    action: command.action,
    ok: true,
    message: `${user.name} has been signed out everywhere.`,
  };
}

/**
 * The person whose authenticator has just stopped working is told why, and by whom. A support
 * action nobody told you about is indistinguishable from a break-in, and this is the difference.
 * Mail failing must not undo a reset that already happened.
 */
async function tellThem(
  deps: SupportDeps,
  user: { name: string; email: string },
  provider: string,
  reason: string | null,
): Promise<void> {
  if (!deps.mailer || deps.appUrl === undefined) return;
  try {
    await deps.mailer.send(
      twoFactorReset({
        to: user.email,
        name: user.name,
        url: `${deps.appUrl}/sign-in`,
        appName: 'CRM',
        by: `your CRM provider (${provider})`,
        reason,
      }),
    );
  } catch (err: unknown) {
    deps.log.warn({ err }, 'could not email a two-factor reset notice');
  }
}

/**
 * Sessions live in Valkey as well as the table, and only clearing both actually signs somebody out.
 * The admin endpoint that normally does this needs an administrator's own session, which a worker
 * acting on a support request does not have.
 */
async function endSessions(deps: SupportDeps, userId: string): Promise<void> {
  const listKey = `${SESSION_LIST_PREFIX}${userId}`;
  const raw = await deps.valkey.get(listKey).catch(() => null);
  if (raw !== null) {
    try {
      const sessions = JSON.parse(raw) as { token?: string }[];
      const tokens = sessions.map((s) => s.token).filter((t): t is string => typeof t === 'string');
      if (tokens.length > 0) await deps.valkey.del(...tokens.map((t) => `${SESSION_PREFIX}${t}`));
    } catch {
      // A list we cannot read is a list we cannot trust; the rows below still go.
    }
    await deps.valkey.del(listKey);
  }
  await deps.db.session.deleteMany({ where: { userId } });
}
