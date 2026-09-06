/**
 * Deals & pipeline movement (R-7.2). Stage changes write history + timeline in one transaction.
 */
import type {
  CreateDealBody,
  DealDto,
  UpdateDealBody,
  VisibilityScope,
  boardQuery,
  bulkDealsBody,
  changeStageBody,
  listDealsQuery,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ConflictError,
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { dateOnlyOrNull, isoOrNull, jsonObject } from '../../lib/object.js';
import { SHAPES, assertCanAssign, assertCanWrite, scopeWhere } from '../../lib/scope.js';
import type { AuditContext } from '../audit/audit.service.js';

export interface Actor {
  id: string;
  canAssign: boolean;
}

export const dealSelect = {
  id: true,
  title: true,
  contactId: true,
  contact: { select: { id: true, displayName: true } },
  companyId: true,
  company: { select: { id: true, name: true } },
  pipelineId: true,
  stageId: true,
  stage: { select: { id: true, name: true, type: true, probability: true, sortOrder: true } },
  value: true,
  currency: true,
  probability: true,
  expectedCloseDate: true,
  ownerId: true,
  owner: { select: { id: true, name: true } },
  status: true,
  wonAt: true,
  lostAt: true,
  lostReason: true,
  customFields: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.DealSelect;

type DealRow = Prisma.DealGetPayload<{ select: typeof dealSelect }>;

export function dealToDto(r: DealRow): DealDto {
  const value = Number(r.value);
  return {
    id: r.id,
    title: r.title,
    contact: r.contact,
    contactId: r.contactId,
    company: r.company,
    companyId: r.companyId,
    pipelineId: r.pipelineId,
    stage: {
      id: r.stage.id,
      name: r.stage.name,
      type: r.stage.type,
      probability: r.stage.probability,
    },
    stageId: r.stageId,
    value,
    currency: r.currency,
    probability: r.probability,
    weightedValue: Math.round(value * r.probability) / 100,
    expectedCloseDate: dateOnlyOrNull(r.expectedCloseDate),
    owner: r.owner,
    ownerId: r.ownerId,
    status: r.status as DealDto['status'],
    wonAt: isoOrNull(r.wonAt),
    lostAt: isoOrNull(r.lostAt),
    lostReason: r.lostReason,
    customFields: jsonObject(r.customFields),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: isoOrNull(r.deletedAt),
  };
}

export class DealsService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  private async resolvePipelineAndStage(
    pipelineId: string | undefined,
    stageId: string | undefined,
  ) {
    const pipeline = pipelineId
      ? await this.db.pipeline.findUnique({
          where: { id: pipelineId },
          include: { stages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        })
      : await this.db.pipeline.findFirst({
          where: { isDefault: true },
          include: { stages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        });
    if (!pipeline)
      throw new ValidationError([{ path: 'pipelineId', message: 'Pipeline not found' }]);
    const stage = stageId
      ? pipeline.stages.find((s) => s.id === stageId)
      : pipeline.stages.find((s) => s.type === 'open');
    if (!stage)
      throw new ValidationError([{ path: 'stageId', message: 'Stage not found in pipeline' }]);
    return { pipeline, stage };
  }

  private async assertContact(scope: VisibilityScope, contactId: string | null | undefined) {
    if (!contactId) return null;
    const c = await this.db.contact.findFirst({
      where: { id: contactId, ...scopeWhere(scope, SHAPES.contact) },
      select: { id: true, companyId: true },
    });
    if (!c) throw new ValidationError([{ path: 'contactId', message: 'Contact not found' }]);
    return c;
  }

  private async assertCompany(scope: VisibilityScope, companyId: string | null | undefined) {
    if (!companyId) return;
    const c = await this.db.company.findFirst({
      where: { id: companyId, ...scopeWhere(scope, SHAPES.company) },
      select: { id: true },
    });
    if (!c) throw new ValidationError([{ path: 'companyId', message: 'Company not found' }]);
  }

  async list(scope: VisibilityScope, q: z.infer<typeof listDealsQuery>) {
    const where: Prisma.DealWhereInput = {
      AND: [
        scopeWhere(scope, SHAPES.deal),
        ...(q.pipelineId ? [{ pipelineId: q.pipelineId }] : []),
        ...(q.stageId ? [{ stageId: q.stageId }] : []),
        ...(q.ownerId ? [{ ownerId: q.ownerId }] : []),
        ...(q.contactId ? [{ contactId: q.contactId }] : []),
        ...(q.companyId ? [{ companyId: q.companyId }] : []),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.closeFrom || q.closeTo
          ? [
              {
                expectedCloseDate: {
                  ...(q.closeFrom ? { gte: new Date(q.closeFrom) } : {}),
                  ...(q.closeTo ? { lte: new Date(q.closeTo) } : {}),
                },
              },
            ]
          : []),
        ...(q.q
          ? [
              {
                OR: [
                  { title: { contains: q.q, mode: 'insensitive' as const } },
                  { contact: { displayName: { contains: q.q, mode: 'insensitive' as const } } },
                  { company: { name: { contains: q.q, mode: 'insensitive' as const } } },
                ],
              },
            ]
          : []),
      ],
    };
    const orderBy =
      q.sort.length > 0
        ? q.sort.map((s) => ({ [s.field]: s.direction }))
        : [{ updatedAt: 'desc' as const }];
    const [rows, total] = await Promise.all([
      this.db.deal.findMany({
        where,
        select: dealSelect,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.deal.count({ where }),
    ]);
    return { data: rows.map(dealToDto), page: { page: q.page, pageSize: q.pageSize, total } };
  }

  async board(scope: VisibilityScope, q: z.infer<typeof boardQuery>) {
    const pipeline = q.pipelineId
      ? await this.db.pipeline.findUnique({
          where: { id: q.pipelineId },
          include: { stages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        })
      : await this.db.pipeline.findFirst({
          where: { isDefault: true },
          include: { stages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        });
    if (!pipeline) throw new NotFoundError('Pipeline');
    const rows = await this.db.deal.findMany({
      where: {
        AND: [
          scopeWhere(scope, SHAPES.deal) as Prisma.DealWhereInput,
          { pipelineId: pipeline.id, status: 'open' },
          ...(q.ownerId ? [{ ownerId: q.ownerId }] : []),
        ],
      },
      select: dealSelect,
      orderBy: [{ expectedCloseDate: 'asc' }, { updatedAt: 'desc' }],
      take: 2000,
    });
    const byStage = new Map<string, DealDto[]>();
    for (const r of rows) {
      const list = byStage.get(r.stageId) ?? [];
      list.push(dealToDto(r));
      byStage.set(r.stageId, list);
    }
    return {
      pipelineId: pipeline.id,
      columns: pipeline.stages
        .filter((s) => s.type === 'open')
        .map((s) => {
          const deals = byStage.get(s.id) ?? [];
          return {
            stage: {
              id: s.id,
              name: s.name,
              type: s.type,
              probability: s.probability,
              sortOrder: s.sortOrder,
            },
            deals,
            count: deals.length,
            totalValue: Math.round(deals.reduce((sum, d) => sum + d.value, 0) * 100) / 100,
          };
        }),
    };
  }

  async getVisible(scope: VisibilityScope, id: string): Promise<DealRow> {
    const row = await this.db.deal.findFirst({
      where: { id, ...(scopeWhere(scope, SHAPES.deal) as Prisma.DealWhereInput) },
      select: dealSelect,
    });
    if (!row) throw new NotFoundError('Deal');
    return row;
  }

  async get(scope: VisibilityScope, id: string): Promise<DealDto> {
    return dealToDto(await this.getVisible(scope, id));
  }

  async create(
    scope: VisibilityScope,
    actor: Actor,
    body: CreateDealBody,
    ctx: AuditContext,
  ): Promise<DealDto> {
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    const contact = await this.assertContact(scope, body.contactId);
    await this.assertCompany(scope, body.companyId);
    const { pipeline, stage } = await this.resolvePipelineAndStage(body.pipelineId, body.stageId);
    const customFields = await this.app.customFields.validate('deal', body.customFields);
    const currency = body.currency ?? (await this.app.settings.get('currency'));
    const id = newId();
    const companyId = body.companyId ?? contact?.companyId ?? null;
    await this.db.$transaction(async (tx) => {
      await tx.deal.create({
        data: {
          id,
          title: body.title,
          contactId: body.contactId ?? null,
          companyId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          value: body.value,
          currency,
          probability: body.probability ?? stage.probability,
          expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
          ownerId: body.ownerId === undefined ? actor.id : body.ownerId,
          status: stage.type === 'open' ? 'open' : stage.type,
          wonAt: stage.type === 'won' ? new Date() : null,
          lostAt: stage.type === 'lost' ? new Date() : null,
          customFields: customFields as object,
          createdById: actor.id,
        },
      });
      await tx.dealStageHistory.create({
        data: {
          id: newId(),
          dealId: id,
          fromStageId: null,
          toStageId: stage.id,
          changedById: actor.id,
        },
      });
      await this.app.activity.record(tx, {
        type: 'deal_created',
        contactId: body.contactId ?? null,
        dealId: id,
        companyId,
        actorId: actor.id,
        summary: `Deal "${body.title}" created in ${stage.name}`,
        refTable: 'deals',
        refId: id,
        meta: { value: body.value, currency, stage: stage.name },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'deal.create',
        entity: 'deal',
        entityId: id,
        after: body,
      });
    });
    const dto = await this.get(scope, id);
    this.app.events.emit('entity.changed', {
      type: 'deal',
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
    body: UpdateDealBody,
    ctx: AuditContext,
  ): Promise<DealDto> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.ownerId, actor.id);
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    if (
      body.expectedUpdatedAt &&
      new Date(body.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()
    )
      throw new StaleVersionError();
    await this.assertContact(scope, body.contactId);
    await this.assertCompany(scope, body.companyId);
    const customFields =
      body.customFields === undefined
        ? undefined
        : await this.app.customFields.validate(
            'deal',
            body.customFields,
            jsonObject(before.customFields),
          );
    await this.db.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
          ...(body.value !== undefined ? { value: body.value } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.probability !== undefined ? { probability: body.probability } : {}),
          ...(body.expectedCloseDate !== undefined
            ? {
                expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
              }
            : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(customFields !== undefined ? { customFields: customFields as object } : {}),
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'deal.update',
        entity: 'deal',
        entityId: id,
        before: dealToDto(before),
        after: body,
      });
    });
    const dto = await this.get(scope, id);
    this.app.events.emit('entity.changed', {
      type: 'deal',
      id,
      updatedAt: dto.updatedAt,
      byUserId: actor.id,
    });
    return dto;
  }

  async changeStage(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    body: z.infer<typeof changeStageBody>,
    ctx: AuditContext,
  ): Promise<DealDto> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.ownerId, actor.id);
    if (
      body.expectedUpdatedAt &&
      new Date(body.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()
    )
      throw new StaleVersionError();
    const stage = await this.db.pipelineStage.findFirst({
      where: { id: body.stageId, pipelineId: before.pipelineId, isActive: true },
    });
    if (!stage)
      throw new ValidationError([{ path: 'stageId', message: 'Stage not found in this pipeline' }]);
    if (stage.id === before.stageId) return dealToDto(before);
    if (stage.type === 'lost' && !body.lostReason)
      throw new ValidationError([
        { path: 'lostReason', message: 'A reason is required when marking a deal lost' },
      ]);

    const status = stage.type === 'open' ? 'open' : stage.type;
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id },
        data: {
          stageId: stage.id,
          status,
          probability: stage.probability,
          wonAt: stage.type === 'won' ? now : null,
          lostAt: stage.type === 'lost' ? now : null,
          lostReason: stage.type === 'lost' ? (body.lostReason ?? null) : null,
        },
      });
      await tx.dealStageHistory.create({
        data: {
          id: newId(),
          dealId: id,
          fromStageId: before.stageId,
          toStageId: stage.id,
          changedById: actor.id,
          changedAt: now,
        },
      });
      const type =
        stage.type === 'won' ? 'deal_won' : stage.type === 'lost' ? 'deal_lost' : 'deal_stage';
      await this.app.activity.record(tx, {
        type,
        contactId: before.contactId,
        dealId: id,
        companyId: before.companyId,
        actorId: actor.id,
        occurredAt: now,
        summary:
          stage.type === 'won'
            ? `Deal "${before.title}" won`
            : stage.type === 'lost'
              ? `Deal "${before.title}" lost: ${body.lostReason ?? ''}`
              : `Deal "${before.title}" moved ${before.stage.name} → ${stage.name}`,
        refTable: 'deals',
        refId: id,
        meta: {
          fromStage: before.stage.name,
          toStage: stage.name,
          value: Number(before.value),
          currency: before.currency,
          ...(body.lostReason ? { lostReason: body.lostReason } : {}),
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'deal.stage_change',
        entity: 'deal',
        entityId: id,
        before: { stage: before.stage.name, status: before.status },
        after: { stage: stage.name, status },
      });
    });
    const dto = await this.get(scope, id);
    this.app.events.emit('deal.stage_changed', {
      dealId: id,
      title: before.title,
      fromStage: before.stage.name,
      toStage: stage.name,
      status,
      ownerId: before.ownerId,
      byUserId: actor.id,
    });
    this.app.events.emit('entity.changed', {
      type: 'deal',
      id,
      updatedAt: dto.updatedAt,
      byUserId: actor.id,
    });
    return dto;
  }

  async history(scope: VisibilityScope, id: string) {
    await this.getVisible(scope, id);
    const rows = await this.db.dealStageHistory.findMany({
      where: { dealId: id },
      orderBy: { changedAt: 'desc' },
      select: {
        id: true,
        changedAt: true,
        fromStage: { select: { id: true, name: true } },
        toStage: { select: { id: true, name: true } },
        changedById: true,
      },
    });
    const users = await this.db.user.findMany({
      where: { id: { in: rows.map((r) => r.changedById).filter((v): v is string => v !== null) } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      fromStage: r.fromStage,
      toStage: r.toStage,
      changedBy: r.changedById
        ? { id: r.changedById, name: names.get(r.changedById) ?? 'Unknown' }
        : null,
      changedAt: r.changedAt.toISOString(),
    }));
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
      await tx.deal.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'deal.delete',
        entity: 'deal',
        entityId: id,
        before: dealToDto(before),
      });
    });
  }

  async restore(scope: VisibilityScope, id: string, ctx: AuditContext): Promise<DealDto> {
    const row = await this.db.deal.findFirst({
      where: {
        id,
        deletedAt: { not: null },
        ...(scopeWhere(scope, SHAPES.deal) as Prisma.DealWhereInput),
      },
      select: { id: true },
    });
    if (!row) throw new NotFoundError('Deal');
    await this.db.deal.update({ where: { id }, data: { deletedAt: null } });
    await this.app.audit.write(ctx, { action: 'deal.restore', entity: 'deal', entityId: id });
    return this.get(scope, id);
  }

  async bulk(
    scope: VisibilityScope,
    actor: Actor,
    body: z.infer<typeof bulkDealsBody>,
    ctx: AuditContext,
  ): Promise<{ affected: number; skipped: string[] }> {
    const visible = await this.db.deal.findMany({
      where: { id: { in: body.ids }, ...(scopeWhere(scope, SHAPES.deal) as Prisma.DealWhereInput) },
      select: { id: true, ownerId: true },
    });
    const writable = visible.filter(
      (d) => scope.kind !== 'own' || d.ownerId === null || d.ownerId === actor.id,
    );
    const ids = writable.map((d) => d.id);
    const skipped = body.ids.filter((id) => !ids.includes(id));
    if (ids.length === 0) return { affected: 0, skipped };
    if (body.action === 'stage') {
      if (!body.stageId)
        throw new ValidationError([{ path: 'stageId', message: 'stageId is required' }]);
      let affected = 0;
      for (const id of ids) {
        try {
          await this.changeStage(
            scope,
            actor,
            id,
            { stageId: body.stageId, lostReason: 'Bulk update' },
            ctx,
          );
          affected++;
        } catch (err) {
          if (!(err instanceof ValidationError) && !(err instanceof ConflictError)) throw err;
          skipped.push(id);
        }
      }
      return { affected, skipped };
    }
    await this.db.$transaction(async (tx) => {
      if (body.action === 'assign') {
        assertCanAssign(actor.canAssign, body.ownerId, actor.id);
        await tx.deal.updateMany({
          where: { id: { in: ids } },
          data: { ownerId: body.ownerId ?? null },
        });
      } else {
        await tx.deal.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: `deal.bulk_${body.action}`,
        entity: 'deal',
        after: { ids, ownerId: body.ownerId },
      });
    });
    return { affected: ids.length, skipped };
  }
}
