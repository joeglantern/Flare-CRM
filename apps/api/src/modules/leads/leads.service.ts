/**
 * Leads (R-7.2.1): capture → qualify → convert into contact (+ company, + deal).
 */
import {
  formatNational,
  toE164,
  type ConvertLeadBody,
  type CreateLeadBody,
  type LeadDto,
  type UpdateLeadBody,
  type VisibilityScope,
  type bulkLeadsBody,
  type listLeadsQuery,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ConflictError,
  DuplicateError,
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { isoOrNull, jsonObject } from '../../lib/object.js';
import { SHAPES, assertCanAssign, assertCanWrite, scopeWhere } from '../../lib/scope.js';
import type { AuditContext } from '../audit/audit.service.js';
import { displayNameOf } from '../contacts/contacts.mappers.js';
import { ContactsService } from '../contacts/contacts.service.js';

export interface Actor {
  id: string;
  canAssign: boolean;
}

const leadSelect = {
  id: true,
  firstName: true,
  lastName: true,
  companyName: true,
  phoneE164: true,
  phoneRaw: true,
  email: true,
  source: true,
  sourceRef: true,
  status: true,
  ownerId: true,
  owner: { select: { id: true, name: true } },
  notes: true,
  customFields: true,
  convertedContactId: true,
  convertedDealId: true,
  convertedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof leadSelect }>;

export function leadToDto(r: LeadRow): LeadDto {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    companyName: r.companyName,
    phone: r.phoneE164,
    phoneDisplay: r.phoneE164 ? formatNational(r.phoneE164) : null,
    email: r.email,
    source: r.source as LeadDto['source'],
    sourceRef: r.sourceRef,
    status: r.status as LeadDto['status'],
    owner: r.owner,
    ownerId: r.ownerId,
    notes: r.notes,
    customFields: jsonObject(r.customFields),
    convertedContactId: r.convertedContactId,
    convertedDealId: r.convertedDealId,
    convertedAt: isoOrNull(r.convertedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export class LeadsService {
  private readonly contacts: ContactsService;

  constructor(private readonly app: FastifyInstance) {
    this.contacts = new ContactsService(app);
  }

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

  async list(scope: VisibilityScope, q: z.infer<typeof listLeadsQuery>) {
    const where: Prisma.LeadWhereInput = {
      AND: [
        scopeWhere(scope, SHAPES.lead),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.source ? [{ source: q.source }] : []),
        ...(q.ownerId ? [{ ownerId: q.ownerId }] : []),
        ...(q.q
          ? [
              {
                OR: [
                  { firstName: { contains: q.q, mode: 'insensitive' as const } },
                  { lastName: { contains: q.q, mode: 'insensitive' as const } },
                  { companyName: { contains: q.q, mode: 'insensitive' as const } },
                  { email: { contains: q.q, mode: 'insensitive' as const } },
                  { phoneE164: { contains: q.q.replace(/\D/g, '') || ' ' } },
                ],
              },
            ]
          : []),
      ],
    };
    const orderBy =
      q.sort.length > 0
        ? q.sort.map((s) => ({ [s.field]: s.direction }))
        : [{ createdAt: 'desc' as const }];
    const [rows, total] = await Promise.all([
      this.db.lead.findMany({
        where,
        select: leadSelect,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.lead.count({ where }),
    ]);
    return { data: rows.map(leadToDto), page: { page: q.page, pageSize: q.pageSize, total } };
  }

  async getVisible(scope: VisibilityScope, id: string): Promise<LeadRow> {
    const row = await this.db.lead.findFirst({
      where: { id, ...(scopeWhere(scope, SHAPES.lead) as Prisma.LeadWhereInput) },
      select: leadSelect,
    });
    if (!row) throw new NotFoundError('Lead');
    return row;
  }

  async get(scope: VisibilityScope, id: string): Promise<LeadDto> {
    return leadToDto(await this.getVisible(scope, id));
  }

  /** Used by the public web-form endpoint too (actor = null, owner from the form). */
  async createRaw(
    body: CreateLeadBody,
    createdById: string | null,
    ownerId: string | null,
    ctx: AuditContext,
  ): Promise<LeadRow> {
    const phoneE164 = await this.phone(body.phone);
    const customFields = await this.app.customFields.validate('lead', body.customFields);
    const id = newId();
    await this.db.$transaction(async (tx) => {
      await tx.lead.create({
        data: {
          id,
          firstName: body.firstName,
          lastName: body.lastName ?? null,
          companyName: body.companyName ?? null,
          phoneE164: phoneE164 ?? null,
          phoneRaw: body.phone ?? null,
          email: body.email ?? null,
          source: body.source,
          sourceRef: body.sourceRef ?? null,
          ownerId,
          notes: body.notes ?? null,
          customFields: customFields as object,
          createdById,
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'lead.create',
        entity: 'lead',
        entityId: id,
        after: body,
      });
    });
    return this.db.lead.findUniqueOrThrow({ where: { id }, select: leadSelect });
  }

  async create(
    _scope: VisibilityScope,
    actor: Actor,
    body: CreateLeadBody,
    ctx: AuditContext,
  ): Promise<LeadDto> {
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    const row = await this.createRaw(
      body,
      actor.id,
      body.ownerId === undefined ? actor.id : body.ownerId,
      ctx,
    );
    const dto = leadToDto(row);
    this.app.events.emit('entity.changed', {
      type: 'lead',
      id: dto.id,
      updatedAt: dto.updatedAt,
      byUserId: actor.id,
    });
    return dto;
  }

  async update(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    body: UpdateLeadBody,
    ctx: AuditContext,
  ): Promise<LeadDto> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.ownerId, actor.id);
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    if (before.status === 'converted') throw new ConflictError('Converted leads are read-only');
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
            'lead',
            body.customFields,
            jsonObject(before.customFields),
          );
    await this.db.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
          ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
          ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
          ...(phoneE164 !== undefined ? { phoneE164, phoneRaw: body.phone ?? null } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(customFields !== undefined ? { customFields: customFields as object } : {}),
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'lead.update',
        entity: 'lead',
        entityId: id,
        before: leadToDto(before),
        after: body,
      });
    });
    const dto = await this.get(scope, id);
    this.app.events.emit('entity.changed', {
      type: 'lead',
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
      await tx.lead.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'lead.delete',
        entity: 'lead',
        entityId: id,
        before: leadToDto(before),
      });
    });
  }

  async convert(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    body: ConvertLeadBody,
    ctx: AuditContext,
  ) {
    const lead = await this.getVisible(scope, id);
    assertCanWrite(scope, lead.ownerId, actor.id);
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    if (lead.status === 'converted') throw new ConflictError('Lead is already converted');
    const ownerId = body.ownerId === undefined ? (lead.ownerId ?? actor.id) : body.ownerId;

    // existing contact by id, or dedupe on identifiers
    let contactId: string;
    let companyId: string | null = null;
    if (body.existingContactId) {
      const existing = await this.db.contact.findFirst({
        where: { id: body.existingContactId, ...scopeWhere(scope, SHAPES.contact) },
        select: { id: true, companyId: true },
      });
      if (!existing)
        throw new ValidationError([{ path: 'existingContactId', message: 'Contact not found' }]);
      contactId = existing.id;
      companyId = existing.companyId;
    } else {
      const dup = await this.contacts.findDuplicates({
        phones: lead.phoneE164 ? [lead.phoneE164] : [],
        emails: lead.email ? [lead.email] : [],
      });
      if (dup.length > 0)
        throw new DuplicateError(
          'A contact with this phone/email exists; pass existingContactId to link it',
          dup,
        );
      contactId = newId();
    }

    let dealId: string | null = null;
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      if (!body.existingContactId) {
        if (body.createCompany && lead.companyName) {
          const found = await tx.company.findFirst({
            where: { name: { equals: lead.companyName, mode: 'insensitive' } },
            select: { id: true },
          });
          if (found) companyId = found.id;
          else {
            companyId = newId();
            await tx.company.create({
              data: { id: companyId, name: lead.companyName, ownerId, createdById: actor.id },
            });
          }
        }
        await tx.contact.create({
          data: {
            id: contactId,
            firstName: lead.firstName,
            lastName: lead.lastName,
            displayName: displayNameOf(lead.firstName, lead.lastName),
            companyId,
            ownerId,
            source:
              lead.source === 'webform'
                ? 'webform'
                : lead.source === 'import'
                  ? 'import'
                  : lead.source === 'call'
                    ? 'call'
                    : lead.source === 'chat'
                      ? 'chat'
                      : 'manual',
            customFields: jsonObject(lead.customFields) as object,
            createdById: actor.id,
            ...(lead.phoneE164
              ? {
                  phones: {
                    create: [
                      {
                        id: newId(),
                        e164: lead.phoneE164,
                        raw: lead.phoneRaw ?? lead.phoneE164,
                        type: 'mobile',
                        isPrimary: true,
                      },
                    ],
                  },
                }
              : {}),
            ...(lead.email
              ? { emails: { create: [{ id: newId(), email: lead.email, isPrimary: true }] } }
              : {}),
          },
        });
        await this.app.activity.record(tx, {
          type: 'contact_created',
          contactId,
          companyId,
          actorId: actor.id,
          occurredAt: now,
          summary: `Contact created from lead (${lead.source})`,
          refTable: 'contacts',
          refId: contactId,
          meta: { source: lead.source, leadId: id },
        });
      }

      if (body.createDeal) {
        const pipeline = body.pipelineId
          ? await tx.pipeline.findUnique({
              where: { id: body.pipelineId },
              include: { stages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
            })
          : await tx.pipeline.findFirst({
              where: { isDefault: true },
              include: { stages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
            });
        const stage = pipeline?.stages.find((s) => s.type === 'open');
        if (!pipeline || !stage)
          throw new ValidationError([
            { path: 'pipelineId', message: 'Pipeline has no open stage' },
          ]);
        dealId = newId();
        const title =
          body.dealTitle ??
          `${displayNameOf(lead.firstName, lead.lastName)}${lead.companyName ? ` – ${lead.companyName}` : ''}`;
        const currency = await this.app.settings.get('currency');
        await tx.deal.create({
          data: {
            id: dealId,
            title,
            contactId,
            companyId,
            pipelineId: pipeline.id,
            stageId: stage.id,
            value: body.dealValue ?? 0,
            currency,
            probability: stage.probability,
            expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
            ownerId,
            createdById: actor.id,
          },
        });
        await tx.dealStageHistory.create({
          data: {
            id: newId(),
            dealId,
            fromStageId: null,
            toStageId: stage.id,
            changedById: actor.id,
          },
        });
        await this.app.activity.record(tx, {
          type: 'deal_created',
          contactId,
          dealId,
          companyId,
          actorId: actor.id,
          occurredAt: now,
          summary: `Deal "${title}" created from lead`,
          refTable: 'deals',
          refId: dealId,
          meta: { value: body.dealValue ?? 0, currency, stage: stage.name },
        });
      }

      await tx.lead.update({
        where: { id },
        data: {
          status: 'converted',
          convertedContactId: contactId,
          convertedDealId: dealId,
          convertedAt: now,
        },
      });
      await this.app.activity.record(tx, {
        type: 'lead_converted',
        contactId,
        dealId,
        companyId,
        actorId: actor.id,
        occurredAt: now,
        summary: 'Lead converted',
        refTable: 'leads',
        refId: id,
        meta: { leadId: id },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'lead.convert',
        entity: 'lead',
        entityId: id,
        after: { contactId, dealId, companyId },
      });
    });

    const dto = await this.get(scope, id);
    this.app.events.emit('entity.changed', {
      type: 'lead',
      id,
      updatedAt: dto.updatedAt,
      byUserId: actor.id,
    });
    return { lead: dto, contactId, dealId, companyId };
  }

  async bulk(
    scope: VisibilityScope,
    actor: Actor,
    body: z.infer<typeof bulkLeadsBody>,
    ctx: AuditContext,
  ): Promise<{ affected: number; skipped: string[] }> {
    const visible = await this.db.lead.findMany({
      where: {
        id: { in: body.ids },
        status: { not: 'converted' },
        ...(scopeWhere(scope, SHAPES.lead) as Prisma.LeadWhereInput),
      },
      select: { id: true, ownerId: true },
    });
    const writable = visible.filter(
      (l) => scope.kind !== 'own' || l.ownerId === null || l.ownerId === actor.id,
    );
    const ids = writable.map((l) => l.id);
    const skipped = body.ids.filter((id) => !ids.includes(id));
    if (ids.length === 0) return { affected: 0, skipped };
    await this.db.$transaction(async (tx) => {
      switch (body.action) {
        case 'assign':
          assertCanAssign(actor.canAssign, body.ownerId, actor.id);
          await tx.lead.updateMany({
            where: { id: { in: ids } },
            data: { ownerId: body.ownerId ?? null },
          });
          break;
        case 'status':
          if (!body.status)
            throw new ValidationError([{ path: 'status', message: 'status is required' }]);
          await tx.lead.updateMany({ where: { id: { in: ids } }, data: { status: body.status } });
          break;
        case 'delete':
          await tx.lead.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
          break;
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: `lead.bulk_${body.action}`,
        entity: 'lead',
        after: { ids, ownerId: body.ownerId, status: body.status },
      });
    });
    return { affected: ids.length, skipped };
  }
}
