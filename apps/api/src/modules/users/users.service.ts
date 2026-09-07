/**
 * User lifecycle (docs/07 §6). Creation, role changes and session revocation go through
 * Better Auth's admin API (with the acting admin's headers so Better Auth re-checks authority);
 * CRM-specific fields are written directly.
 */
import { fromNodeHeaders } from 'better-auth/node';
import {
  roleHasPermission,
  statement,
  toE164,
  type CreateUserBody,
  type listUsersQuery,
  type MeDto,
  type Permission,
  type updateMeBody,
  type UpdateUserBody,
  type UserDto,
} from '@crm/shared';
import type { z } from 'zod';
import type { IncomingHttpHeaders } from 'node:http';
import type { CountryCode } from 'libphonenumber-js';
import { randomBytes } from 'node:crypto';
import { WELCOME_FLAG_PREFIX, type Auth } from '../../auth/auth.js';
import { ExtensionMap } from '../../integrations/yeastar/extension-map.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { twoFactorRequiredFor } from '../../plugins/authorize.js';
import type { Db } from '../../plugins/prisma.js';
import type { AuditContext, AuditService } from '../audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { Storage } from '../../integrations/storage/storage.js';
import type { Redis } from 'ioredis';

export interface UsersDeps {
  db: Db;
  auth: Auth;
  valkey: Redis;
  audit: AuditService;
  settings: SettingsService;
  storage: Storage;
  appUrl: string;
  avatarUrl: (key: string | null) => string | null;
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  role: true,
  extension: true,
  teamId: true,
  team: { select: { id: true, name: true } },
  phone: true,
  timezone: true,
  locale: true,
  isActive: true,
  banned: true,
  twoFactorEnabled: true,
  avatarKey: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string | null;
  extension: string | null;
  teamId: string | null;
  team: { id: string; name: string } | null;
  phone: string | null;
  timezone: string;
  locale: string;
  isActive: boolean;
  banned: boolean | null;
  twoFactorEnabled: boolean | null;
  avatarKey: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class UsersService {
  constructor(private readonly deps: UsersDeps) {}

  toDto(row: UserRow): UserDto {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: row.emailVerified,
      role: (row.role ?? 'agent') as UserDto['role'],
      extension: row.extension,
      teamId: row.teamId,
      team: row.team,
      phone: row.phone,
      timezone: row.timezone,
      locale: row.locale,
      isActive: row.isActive,
      banned: row.banned ?? false,
      twoFactorEnabled: row.twoFactorEnabled ?? false,
      avatarUrl: this.deps.avatarUrl(row.avatarKey),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  permissionsOf(role: string): Permission[] {
    const out: Permission[] = [];
    for (const [resource, actions] of Object.entries(statement)) {
      for (const action of actions) {
        const p = `${resource}:${action}` as Permission;
        if (roleHasPermission(role, p)) out.push(p);
      }
    }
    return out;
  }

  async me(userId: string): Promise<MeDto> {
    const row = await this.deps.db.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!row) throw new NotFoundError('User');
    const dto = this.toDto(row);
    const security = await this.deps.settings.get('security');
    return {
      ...dto,
      permissions: this.permissionsOf(dto.role),
      twoFactorRequired: twoFactorRequiredFor(dto.role, security),
    };
  }

  async get(id: string): Promise<UserDto> {
    const row = await this.deps.db.user.findUnique({ where: { id }, select: userSelect });
    if (!row) throw new NotFoundError('User');
    return this.toDto(row);
  }

  async list(query: z.infer<typeof listUsersQuery>) {
    const where = {
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { extension: { contains: query.q } },
            ],
          }
        : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.isActive ? { isActive: query.isActive === 'true' } : {}),
    };
    const [rows, total] = await Promise.all([
      this.deps.db.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.deps.db.user.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toDto(r)),
      page: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  private async normalizePhone(
    phone: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (phone === undefined) return undefined;
    if (phone === null) return null;
    const country = (await this.deps.settings.get('defaultCountry')) as CountryCode;
    const e164 = toE164(phone, country);
    if (!e164) throw new ValidationError([{ path: 'phone', message: 'Invalid phone number' }]);
    return e164;
  }

  private async assertExtensionFree(
    extension: string | null | undefined,
    exceptUserId?: string,
  ): Promise<void> {
    if (!extension) return;
    const clash = await this.deps.db.user.findFirst({
      where: { extension, ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}) },
      select: { id: true, name: true },
    });
    if (clash)
      throw new ConflictError(`Extension ${extension} is already assigned to ${clash.name}`, {
        userId: clash.id,
      });
  }

  private async assertTeam(teamId: string | null | undefined): Promise<void> {
    if (!teamId) return;
    const team = await this.deps.db.team.findUnique({
      where: { id: teamId },
      select: { id: true },
    });
    if (!team) throw new ValidationError([{ path: 'teamId', message: 'Team not found' }]);
  }

  async create(
    body: CreateUserBody,
    actorHeaders: IncomingHttpHeaders,
    ctx: AuditContext,
  ): Promise<UserDto> {
    await this.assertExtensionFree(body.extension);
    await this.assertTeam(body.teamId);
    const phone = await this.normalizePhone(body.phone);

    const existing = await this.deps.db.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    if (existing) throw new ConflictError('A user with this email already exists');

    // Better Auth creates user + credential account with a random password the user will never use.
    const password = randomBytes(24).toString('base64url');
    const created = await this.deps.auth.api.createUser({
      headers: fromNodeHeaders(actorHeaders),
      body: { email: body.email, name: body.name, password, role: body.role },
    });
    const userId = created.user.id;

    await this.deps.db.user.update({
      where: { id: userId },
      data: {
        extension: body.extension ?? null,
        teamId: body.teamId ?? null,
        phone: phone ?? null,
        ...(body.timezone ? { timezone: body.timezone } : {}),
        ...(body.locale ? { locale: body.locale } : {}),
      },
    });

    // welcome email = password reset flow with the welcome template (docs/07 §6)
    await this.deps.valkey.set(`${WELCOME_FLAG_PREFIX}${userId}`, '1', 'EX', 60 * 60 * 24 * 7);
    await this.deps.auth.api.requestPasswordReset({
      body: { email: body.email, redirectTo: `${this.deps.appUrl}/set-password` },
    });

    const dto = await this.get(userId);
    await this.deps.audit.write(ctx, {
      action: 'user.create',
      entity: 'user',
      entityId: userId,
      after: dto,
    });
    return dto;
  }

  async update(id: string, body: UpdateUserBody, ctx: AuditContext): Promise<UserDto> {
    const before = await this.get(id);
    await this.assertExtensionFree(body.extension, id);
    await this.assertTeam(body.teamId);
    const phone = await this.normalizePhone(body.phone);
    await this.deps.db.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.extension !== undefined ? { extension: body.extension } : {}),
        ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
      },
    });
    const after = await this.get(id);
    await this.deps.audit.write(ctx, {
      action: 'user.update',
      entity: 'user',
      entityId: id,
      before,
      after,
    });
    if (before.extension !== after.extension) await ExtensionMap.notifyChanged(this.deps.valkey);
    return after;
  }

  async setRole(
    id: string,
    role: string,
    actorHeaders: IncomingHttpHeaders,
    ctx: AuditContext,
  ): Promise<UserDto> {
    const before = await this.get(id);
    if (before.id === ctx.actorId) throw new ConflictError('You cannot change your own role');
    const headers = fromNodeHeaders(actorHeaders);
    await this.deps.auth.api.setRole({
      headers,
      body: { userId: id, role: role as 'admin' | 'manager' | 'agent' },
    });
    await this.deps.auth.api.revokeUserSessions({ headers, body: { userId: id } });
    const after = await this.get(id);
    await this.deps.audit.write(ctx, {
      action: 'user.role_change',
      entity: 'user',
      entityId: id,
      before: { role: before.role },
      after: { role: after.role },
    });
    return after;
  }

  async setActive(
    id: string,
    isActive: boolean,
    actorHeaders: IncomingHttpHeaders,
    ctx: AuditContext,
  ): Promise<UserDto> {
    const before = await this.get(id);
    if (before.id === ctx.actorId)
      throw new ConflictError('You cannot deactivate your own account');
    await this.deps.db.user.update({ where: { id }, data: { isActive } });
    if (!isActive) {
      await this.deps.auth.api.revokeUserSessions({
        headers: fromNodeHeaders(actorHeaders),
        body: { userId: id },
      });
    }
    const after = await this.get(id);
    await this.deps.audit.write(ctx, {
      action: isActive ? 'user.reactivate' : 'user.deactivate',
      entity: 'user',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
    await ExtensionMap.notifyChanged(this.deps.valkey);
    return after;
  }

  async revokeSessions(
    id: string,
    actorHeaders: IncomingHttpHeaders,
    ctx: AuditContext,
  ): Promise<void> {
    await this.get(id);
    await this.deps.auth.api.revokeUserSessions({
      headers: fromNodeHeaders(actorHeaders),
      body: { userId: id },
    });
    await this.deps.audit.write(ctx, {
      action: 'user.sessions_revoked',
      entity: 'user',
      entityId: id,
    });
  }

  async updateMe(
    userId: string,
    body: z.infer<typeof updateMeBody>,
    ctx: AuditContext,
  ): Promise<MeDto> {
    const phone = await this.normalizePhone(body.phone);
    await this.deps.db.user.update({
      where: { id: userId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
      },
    });
    await this.deps.audit.write(ctx, {
      action: 'user.update_self',
      entity: 'user',
      entityId: userId,
      after: body,
    });
    return this.me(userId);
  }

  async setAvatar(userId: string, key: string | null, ctx: AuditContext): Promise<MeDto> {
    const before = await this.deps.db.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });
    if (!before) throw new NotFoundError('User');
    await this.deps.db.user.update({ where: { id: userId }, data: { avatarKey: key } });
    if (before.avatarKey && before.avatarKey !== key)
      await this.deps.storage.delete(before.avatarKey).catch(() => undefined);
    await this.deps.audit.write(ctx, {
      action: key ? 'user.avatar_set' : 'user.avatar_removed',
      entity: 'user',
      entityId: userId,
    });
    return this.me(userId);
  }

  async touchLastSeen(userId: string): Promise<void> {
    await this.deps.db.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
  }
}
