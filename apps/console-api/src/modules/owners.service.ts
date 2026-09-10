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
import type { Mailer } from '../plugins/mailer.js';
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

const NEWLINE = String.fromCharCode(10);

export class OwnersService {
  constructor(
    private readonly deps: {
      db: Db;
      auth: Auth;
      audit: AuditService;
      /** So the owner this happened to hears it from us rather than from a code that stopped working. */
      mailer?: Mailer;
      consoleUrl?: string;
      log?: { warn: (o: unknown, m: string) => void };
    },
  ) {}

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
    await this.tellThem(before);
    return this.get(id);
  }

  /**
   * There is nobody above an owner here, so an owner whose second factor is cleared without being
   * told has no way to distinguish it from somebody else getting in. Mail failing must not undo a
   * reset that has already happened.
   */
  private async tellThem(owner: OwnerDto): Promise<void> {
    const mailer = this.deps.mailer;
    if (!mailer) return;
    const lines = [
      `Hello ${owner.name},`,
      '',
      'Another owner has reset the two-factor on your console account.',
      'Your old authenticator and backup codes no longer work.',
      '',
      'Sign in with your password and you will be asked to set up a new authenticator:',
      this.deps.consoleUrl ?? '',
      '',
      'If you were not expecting this, say so now: nobody else should be resetting your account.',
    ];
    try {
      await mailer.send({
        to: owner.email,
        subject: 'Your console two-factor has been reset',
        text: lines.join(NEWLINE),
        html: lines.map((line) => (line === '' ? '<br>' : `<p>${line}</p>`)).join(''),
      });
    } catch (err: unknown) {
      this.deps.log?.warn({ err, ownerId: owner.id }, 'could not email a two-factor reset notice');
    }
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

  /**
   * Sends the owner a link to choose a new password. Nobody sets anybody else's password here, so
   * this is the whole of what one owner can do for another who is locked out: the link goes to
   * their address, expires in fifteen minutes, and using it ends every session they had.
   *
   * The account itself is untouched if the mail fails, and the caller is told, because an owner
   * who believes a link is on its way will wait for it rather than trying something else.
   */
  async sendPasswordReset(id: string, ctx: AuditContext): Promise<OwnerDto> {
    const owner = await this.get(id);
    if (!owner.isActive) {
      throw new ConflictError(
        'This account is deactivated. Reactivate it first, or the link will not sign them in',
      );
    }
    try {
      await this.deps.auth.api.requestPasswordReset({
        body: {
          email: owner.email,
          ...(this.deps.consoleUrl === undefined
            ? {}
            : { redirectTo: `${this.deps.consoleUrl}/reset-password` }),
        },
      });
    } catch (err: unknown) {
      this.deps.log?.warn({ err, ownerId: id }, 'could not send an owner password reset');
      throw new ConflictError('The email could not be sent, so no link is on its way');
    }
    await this.deps.audit.write(ctx, {
      action: 'owner.password_reset_sent',
      entity: 'owner',
      entityId: id,
      after: { email: owner.email },
    });
    return owner;
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
