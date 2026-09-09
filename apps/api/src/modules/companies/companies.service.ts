import {
  formatNational,
  toE164,
  type CompanyDto,
  type CreateCompanyBody,
  type UpdateCompanyBody,
  type VisibilityScope,
  type listCompaniesQuery,
} from '@crm/shared';
import type { CountryCode } from 'libphonenumber-js';
import type { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { NotFoundError, StaleVersionError, ValidationError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { isoOrNull, jsonObject } from '../../lib/object.js';
import { SHAPES, assertCanAssign, assertCanWrite, scopeWhere } from '../../lib/scope.js';
import type { AuditContext } from '../audit/audit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const companySelect = {
  id: true,
  name: true,
  industry: true,
  website: true,
  phoneE164: true,
  email: true,
  address: true,
  ownerId: true,
  owner: { select: { id: true, name: true } },
  customFields: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  _count: { select: { contacts: { where: { deletedAt: null } } } },
} satisfies Prisma.CompanySelect;

interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phoneE164: string | null;
  email: string | null;
  address: unknown;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  customFields: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  _count: { contacts: number };
}

export interface OpenDeals {
  count: number;
  value: number;
}

export function companyToDto(r: CompanyRow, deals: OpenDeals = { count: 0, value: 0 }): CompanyDto {
  return {
    id: r.id,
    name: r.name,
    industry: r.industry,
    website: r.website,
    phone: r.phoneE164,
    phoneDisplay: r.phoneE164 ? formatNational(r.phoneE164) : null,
    email: r.email,
    address: r.address && typeof r.address === 'object' ? r.address : null,
    owner: r.owner,
    ownerId: r.ownerId,
    customFields: jsonObject(r.customFields),
    contactCount: r._count.contacts,
    openDealCount: deals.count,
    openDealValue: deals.value,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: isoOrNull(r.deletedAt),
  };
}

export interface Actor {
  id: string;
  canAssign: boolean;
}

/**
 * A name or email is matched loosely; a phone only when the text actually contains digits. The
 * phone clause used to fall back to an impossible value when it had none, and the impossible value
 * chosen was a NUL byte, which Postgres refuses outright, so every search without a digit failed.
 */
function searchClauses(text: string): Prisma.CompanyWhereInput[] {
  const digits = text.replace(/\D/g, '');
  return [
    { name: { contains: text, mode: 'insensitive' } },
    { email: { contains: text, mode: 'insensitive' } },
    ...(digits === '' ? [] : [{ phoneE164: { contains: digits } }]),
  ];
}

export class CompaniesService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  private async phone(input: string | null | undefined): Promise<string | null | undefined> {
    if (input === undefined) return undefined;
    if (input === null) return null;
    const country = (await this.app.settings.get('defaultCountry')) as CountryCode;
    const e164 = toE164(input, country);
    if (!e164) throw new ValidationError([{ path: 'phone', message: 'Invalid phone number' }]);
    return e164;
  }

  async list(scope: VisibilityScope, q: z.infer<typeof listCompaniesQuery>) {
    const where = {
      ...scopeWhere(scope, SHAPES.company),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.industry ? { industry: q.industry } : {}),
      ...(q.q ? { OR: searchClauses(q.q) } : {}),
    };
    const orderBy =
      q.sort.length > 0
        ? q.sort.map((s) => ({ [s.field]: s.direction }))
        : [{ name: 'asc' as const }];
    const [rows, total] = await Promise.all([
      this.db.company.findMany({
        where,
        select: companySelect,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.company.count({ where }),
    ]);
    const deals = await this.openDealsFor(rows.map((r) => r.id));
    return {
      data: rows.map((r) => companyToDto(r, deals[r.id])),
      page: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  /**
   * One grouped query for a page of companies, rather than one deals request per row from the
   * browser, which is what the list did before the DTO carried this (formerly GAP-07).
   */
  private async openDealsFor(ids: string[]): Promise<Record<string, OpenDeals>> {
    if (ids.length === 0) return {};
    const grouped = await this.db.deal.groupBy({
      by: ['companyId'],
      where: { companyId: { in: ids }, status: 'open', deletedAt: null },
      _count: { _all: true },
      _sum: { value: true },
    });
    const out: Record<string, OpenDeals> = {};
    for (const g of grouped) {
      if (g.companyId)
        out[g.companyId] = { count: g._count._all, value: Number(g._sum.value ?? 0) };
    }
    return out;
  }

  async getVisible(scope: VisibilityScope, id: string): Promise<CompanyRow> {
    const row = await this.db.company.findFirst({
      where: { id, ...scopeWhere(scope, SHAPES.company) },
      select: companySelect,
    });
    if (!row) throw new NotFoundError('Company');
    return row;
  }

  async get(scope: VisibilityScope, id: string): Promise<CompanyDto> {
    const row = await this.getVisible(scope, id);
    return companyToDto(row, (await this.openDealsFor([row.id]))[row.id]);
  }

  async create(
    scope: VisibilityScope,
    actor: Actor,
    body: CreateCompanyBody,
    ctx: AuditContext,
  ): Promise<CompanyDto> {
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    const phoneE164 = await this.phone(body.phone);
    const customFields = await this.app.customFields.validate('company', body.customFields);
    const id = newId();
    await this.db.$transaction(async (tx) => {
      await tx.company.create({
        data: {
          id,
          name: body.name,
          industry: body.industry ?? null,
          website: body.website ?? null,
          phoneE164: phoneE164 ?? null,
          email: body.email ?? null,
          ...(body.address ? { address: body.address } : {}),
          ownerId: body.ownerId === undefined ? actor.id : body.ownerId,
          customFields: customFields as object,
          createdById: actor.id,
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'company.create',
        entity: 'company',
        entityId: id,
        after: body,
      });
    });
    const dto = await this.get(scope, id);
    this.app.events.emit('entity.changed', {
      type: 'company',
      id,
      updatedAt: dto.updatedAt,
      byUserId: actor.id,
    });
    return dto;
  }

  async update(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    body: UpdateCompanyBody,
    ctx: AuditContext,
  ): Promise<CompanyDto> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.ownerId, actor.id);
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    if (
      body.expectedUpdatedAt &&
      new Date(body.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()
    )
      throw new StaleVersionError();
    const phoneE164 = await this.phone(body.phone);
    const customFields =
      body.customFields === undefined
        ? undefined
        : await this.app.customFields.validate(
            'company',
            body.customFields,
            jsonObject(before.customFields),
          );
    await this.db.$transaction(async (tx) => {
      await tx.company.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.industry !== undefined ? { industry: body.industry } : {}),
          ...(body.website !== undefined ? { website: body.website } : {}),
          ...(phoneE164 !== undefined ? { phoneE164 } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.address !== undefined ? { address: body.address ?? {} } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(customFields !== undefined ? { customFields: customFields as object } : {}),
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'company.update',
        entity: 'company',
        entityId: id,
        before: companyToDto(before),
        after: body,
      });
    });
    const dto = await this.get(scope, id);
    this.app.events.emit('entity.changed', {
      type: 'company',
      id,
      updatedAt: dto.updatedAt,
      byUserId: actor.id,
    });
    return dto;
  }

  async softDelete(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    ctx: AuditContext,
  ): Promise<void> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.ownerId, actor.id);
    await this.db.$transaction(async (tx) => {
      await tx.company.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'company.delete',
        entity: 'company',
        entityId: id,
        before: companyToDto(before),
      });
    });
  }

  async restore(scope: VisibilityScope, id: string, ctx: AuditContext): Promise<CompanyDto> {
    const row = await this.db.company.findFirst({
      where: { id, deletedAt: { not: null }, ...scopeWhere(scope, SHAPES.company) },
      select: { id: true },
    });
    if (!row) throw new NotFoundError('Company');
    await this.db.$transaction(async (tx) => {
      await tx.company.update({ where: { id }, data: { deletedAt: null } });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'company.restore',
        entity: 'company',
        entityId: id,
      });
    });
    return this.get(scope, id);
  }
}
