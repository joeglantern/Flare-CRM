/**
 * The few things one owner may do to another (docs/21 §2).
 *
 * There is no administrator above an owner here, so these are the only way back in for somebody who
 * has lost their phone and their backup codes. Better Auth has no admin endpoint that clears
 * another account's second factor, so the row goes through Prisma and the sessions through the
 * admin API, exactly as the CRM does it for its own users.
 */
import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import type { Auth } from '../auth/auth.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { AuditContext, AuditService } from './audit.service.js';
import type { Db } from '../plugins/prisma.js';

export interface OwnerDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastSeenAt: string | null;
}

export class OwnersService {
  constructor(private readonly deps: { db: Db; auth: Auth; audit: AuditService }) {}

  async list(): Promise<OwnerDto[]> {
    const rows = await this.deps.db.user.findMany({ orderBy: { name: 'asc' } });
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isActive: u.isActive,
      twoFactorEnabled: u.twoFactorEnabled === true,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    }));
  }

  private async get(id: string): Promise<OwnerDto> {
    const row = await this.deps.db.user.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Owner');
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      isActive: row.isActive,
      twoFactorEnabled: row.twoFactorEnabled === true,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    };
  }

  /**
   * Clears an owner's second factor so they can enrol again. Their sessions go with it: an account
   * that can no longer prove a second factor should not keep the ones it already proved.
   */
  async resetTwoFactor(
    id: string,
    actorHeaders: IncomingHttpHeaders,
    ctx: AuditContext,
  ): Promise<OwnerDto> {
    const before = await this.get(id);
    await this.deps.db.$transaction(async (tx) => {
      await tx.twoFactor.deleteMany({ where: { userId: id } });
      await tx.user.update({ where: { id }, data: { twoFactorEnabled: false } });
    });
    await this.revokeSessionsOf(id, actorHeaders);
    await this.deps.audit.write(ctx, {
      action: 'owner.two_factor_reset',
      entity: 'owner',
      entityId: id,
      before: { twoFactorEnabled: before.twoFactorEnabled },
      after: { twoFactorEnabled: false },
    });
    return this.get(id);
  }

  async setActive(
    id: string,
    isActive: boolean,
    actorId: string,
    ctx: AuditContext,
  ): Promise<OwnerDto> {
    if (id === actorId && !isActive) {
      throw new ConflictError('You cannot deactivate your own account');
    }
    const before = await this.get(id);
    await this.deps.db.user.update({ where: { id }, data: { isActive } });
    await this.deps.audit.write(ctx, {
      action: isActive ? 'owner.reactivate' : 'owner.deactivate',
      entity: 'owner',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
    return this.get(id);
  }

  async revokeSessions(
    id: string,
    actorHeaders: IncomingHttpHeaders,
    ctx: AuditContext,
  ): Promise<OwnerDto> {
    await this.get(id);
    await this.revokeSessionsOf(id, actorHeaders);
    await this.deps.audit.write(ctx, {
      action: 'owner.sessions_revoked',
      entity: 'owner',
      entityId: id,
    });
    return this.get(id);
  }

  /**
   * Better Auth keeps sessions in secondary storage as well as the table, so the admin endpoint is
   * the only thing that clears both. A failure here must not leave the caller thinking the second
   * factor survived, so it is logged by the route rather than swallowed.
   */
  private async revokeSessionsOf(id: string, actorHeaders: IncomingHttpHeaders): Promise<void> {
    await this.deps.auth.api.revokeUserSessions({
      headers: fromNodeHeaders(actorHeaders),
      body: { userId: id },
    });
  }
}
