/**
 * Contacts (R-7.1). Phone/email dedupe, merge, bulk actions, visibility scoping, timeline writes.
 */
import {
  toE164,
  type ContactDto,
  type CreateContactBody,
  type UpdateContactBody,
  type VisibilityScope,
  type bulkContactsBody,
  type duplicateMatch,
  type listContactsQuery,
  type phoneInputItem,
  type emailInputItem,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import type { CountryCode } from 'libphonenumber-js';
import type { z } from 'zod';
import {
  ConflictError,
  DuplicateError,
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { jsonObject } from '../../lib/object.js';
import { SHAPES, assertCanAssign, assertCanWrite, scopeWhere } from '../../lib/scope.js';
import type { AuditContext } from '../audit/audit.service.js';
import {
  contactSelect,
  contactSummarySelect,
  contactToDto,
  contactToSummary,
  displayNameOf,
  type ContactRow,
} from './contacts.mappers.js';

export interface Actor {
  id: string;
  canAssign: boolean;
}

type DuplicateMatch = z.infer<typeof duplicateMatch>;

export class ContactsService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  private async country(): Promise<CountryCode> {
    return (await this.app.settings.get('defaultCountry')) as CountryCode;
  }

  private async normalizePhones(
    items: z.infer<typeof phoneInputItem>[],
  ): Promise<{ e164: string; raw: string; type: string; isPrimary: boolean }[]> {
    const country = await this.country();
    const out: { e164: string; raw: string; type: string; isPrimary: boolean }[] = [];
    const seen = new Set<string>();
    items.forEach((p, i) => {
      const e164 = toE164(p.number, country);
      if (!e164)
        throw new ValidationError([
          { path: `phones.${i}.number`, message: 'Invalid phone number' },
        ]);
      if (seen.has(e164))
        throw new ValidationError([
          { path: `phones.${i}.number`, message: 'Duplicate phone number in request' },
        ]);
      seen.add(e164);
      out.push({ e164, raw: p.number, type: p.type, isPrimary: p.isPrimary ?? false });
    });
    const firstPhone = out[0];
    if (firstPhone && !out.some((p) => p.isPrimary)) firstPhone.isPrimary = true;
    if (out.filter((p) => p.isPrimary).length > 1)
      throw new ValidationError([{ path: 'phones', message: 'Only one primary phone allowed' }]);
    return out;
  }

  private normalizeEmails(
    items: z.infer<typeof emailInputItem>[],
  ): { email: string; isPrimary: boolean }[] {
    const out = items.map((e) => ({ email: e.email, isPrimary: e.isPrimary ?? false }));
    const seen = new Set<string>();
    for (const [i, e] of out.entries()) {
      if (seen.has(e.email))
        throw new ValidationError([
          { path: `emails.${i}.email`, message: 'Duplicate email in request' },
        ]);
      seen.add(e.email);
    }
    const firstEmail = out[0];
    if (firstEmail && !out.some((e) => e.isPrimary)) firstEmail.isPrimary = true;
    if (out.filter((e) => e.isPrimary).length > 1)
      throw new ValidationError([{ path: 'emails', message: 'Only one primary email allowed' }]);
    return out;
  }

  /** R-7.1.4: who already has these identifiers? */
  async findDuplicates(
    input: { phones?: string[]; emails?: string[] },
    exceptContactId?: string,
  ): Promise<DuplicateMatch[]> {
    const matches: DuplicateMatch[] = [];
    if (input.phones && input.phones.length > 0) {
      const rows = await this.db.contactPhone.findMany({
        where: {
          e164: { in: input.phones },
          deletedAt: null,
          contact: { deletedAt: null },
          ...(exceptContactId ? { NOT: { contactId: exceptContactId } } : {}),
        },
        select: { e164: true, contact: { select: contactSummarySelect } },
      });
      for (const r of rows)
        matches.push({ contact: contactToSummary(r.contact), matchedOn: 'phone', value: r.e164 });
    }
    if (input.emails && input.emails.length > 0) {
      const rows = await this.db.contactEmail.findMany({
        where: {
          email: { in: input.emails },
          deletedAt: null,
          contact: { deletedAt: null },
          ...(exceptContactId ? { NOT: { contactId: exceptContactId } } : {}),
        },
        select: { email: true, contact: { select: contactSummarySelect } },
      });
      for (const r of rows)
        matches.push({ contact: contactToSummary(r.contact), matchedOn: 'email', value: r.email });
    }
    return matches;
  }

  async duplicatesQuery(input: {
    phone?: string | undefined;
    email?: string | undefined;
  }): Promise<DuplicateMatch[]> {
    const phones: string[] = [];
    if (input.phone) {
      const e164 = toE164(input.phone, await this.country());
      if (e164) phones.push(e164);
    }
    return this.findDuplicates({ phones, emails: input.email ? [input.email] : [] });
  }

  private searchWhere(q: string): Record<string, unknown> {
    const digits = q.replace(/\D/g, '');
    const or: Record<string, unknown>[] = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { company: { name: { contains: q, mode: 'insensitive' } } },
      { emails: { some: { email: { contains: q, mode: 'insensitive' }, deletedAt: null } } },
    ];
    if (digits.length >= 3)
      or.push({ phones: { some: { e164: { contains: digits }, deletedAt: null } } });
    return { OR: or };
  }

  async list(scope: VisibilityScope, q: z.infer<typeof listContactsQuery>) {
    const where = {
      AND: [
        scopeWhere(scope, SHAPES.contact),
        ...(q.ownerId ? [{ ownerId: q.ownerId }] : []),
        ...(q.companyId ? [{ companyId: q.companyId }] : []),
        ...(q.tag ? [{ tags: { has: q.tag } }] : []),
        ...(q.source ? [{ source: q.source }] : []),
        ...(q.doNotCall ? [{ doNotCall: q.doNotCall === 'true' }] : []),
        ...(q.q ? [this.searchWhere(q.q)] : []),
      ],
    };
    const orderBy =
      q.sort.length > 0
        ? q.sort.map((s) => ({ [s.field]: s.direction }))
        : [{ displayName: 'asc' as const }];
    const [rows, total] = await Promise.all([
      this.db.contact.findMany({
        where,
        select: contactSummarySelect,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.contact.count({ where }),
    ]);
    return {
      data: rows.map(contactToSummary),
      page: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  async getVisible(scope: VisibilityScope, id: string): Promise<ContactRow> {
    const row = await this.db.contact.findFirst({
      where: { id, ...scopeWhere(scope, SHAPES.contact) },
      select: contactSelect,
    });
    if (!row) throw new NotFoundError('Contact');
    return row;
  }

  async get(scope: VisibilityScope, id: string): Promise<ContactDto> {
    return contactToDto(await this.getVisible(scope, id));
  }

  private async assertCompany(
    scope: VisibilityScope,
    companyId: string | null | undefined,
  ): Promise<void> {
    if (!companyId) return;
    const c = await this.db.company.findFirst({
      where: { id: companyId, ...scopeWhere(scope, SHAPES.company) },
      select: { id: true },
    });
    if (!c) throw new ValidationError([{ path: 'companyId', message: 'Company not found' }]);
  }

  async create(
    scope: VisibilityScope,
    actor: Actor,
    body: CreateContactBody,
    ctx: AuditContext,
  ): Promise<ContactDto> {
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    await this.assertCompany(scope, body.companyId);
    const phones = await this.normalizePhones(body.phones);
    const emails = this.normalizeEmails(body.emails);
    const duplicates = await this.findDuplicates({
      phones: phones.map((p) => p.e164),
      emails: emails.map((e) => e.email),
    });
    if (duplicates.length > 0)
      throw new DuplicateError(
        'A contact with this phone number or email already exists',
        duplicates,
      );
    const customFields = await this.app.customFields.validate('contact', body.customFields);

    const id = newId();
    const ownerId = body.ownerId === undefined ? actor.id : body.ownerId;
    await this.db.$transaction(async (tx) => {
      await tx.contact.create({
        data: {
          id,
          firstName: body.firstName,
          lastName: body.lastName ?? null,
          displayName: displayNameOf(body.firstName, body.lastName),
          companyId: body.companyId ?? null,
          jobTitle: body.jobTitle ?? null,
          ownerId,
          source: body.source,
          tags: [...new Set(body.tags)],
          customFields: customFields as object,
          preferredChannel: body.preferredChannel ?? null,
          doNotCall: body.doNotCall,
          createdById: actor.id,
          phones: { create: phones.map((p) => ({ id: newId(), ...p })) },
          emails: { create: emails.map((e) => ({ id: newId(), ...e })) },
        },
      });
      await this.app.activity.record(tx, {
        type: 'contact_created',
        contactId: id,
        companyId: body.companyId ?? null,
        actorId: actor.id,
        summary: `Contact created (${body.source})`,
        refTable: 'contacts',
        refId: id,
        meta: { source: body.source },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.create',
        entity: 'contact',
        entityId: id,
        after: { ...body, phones, emails },
      });
      if (body.linkCallId) {
        const call = await tx.call.findUnique({
          where: { id: body.linkCallId },
          select: { id: true, contactId: true },
        });
        if (call?.contactId === null) {
          await tx.call.update({ where: { id: call.id }, data: { contactId: id } });
          await tx.activity.updateMany({
            where: { refTable: 'calls', refId: call.id },
            data: { contactId: id },
          });
        }
      }
    });
    const dto = await this.get(scope, id);
    this.app.events.emit('contact.created', {
      contactId: id,
      byUserId: actor.id,
      linkCallId: body.linkCallId,
    });
    this.app.events.emit('entity.changed', {
      type: 'contact',
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
    body: UpdateContactBody,
    ctx: AuditContext,
  ): Promise<ContactDto> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.ownerId, actor.id);
    assertCanAssign(actor.canAssign, body.ownerId, actor.id);
    if (
      body.expectedUpdatedAt &&
      new Date(body.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()
    )
      throw new StaleVersionError();
    await this.assertCompany(scope, body.companyId);
    const customFields =
      body.customFields === undefined
        ? undefined
        : await this.app.customFields.validate(
            'contact',
            body.customFields,
            jsonObject(before.customFields),
          );
    const firstName = body.firstName ?? before.firstName;
    const lastName = body.lastName === undefined ? before.lastName : body.lastName;

    await this.db.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id },
        data: {
          ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
          ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
          ...(body.firstName !== undefined || body.lastName !== undefined
            ? { displayName: displayNameOf(firstName, lastName) }
            : {}),
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
          ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(body.tags !== undefined ? { tags: [...new Set(body.tags)] } : {}),
          ...(customFields !== undefined ? { customFields: customFields as object } : {}),
          ...(body.preferredChannel !== undefined
            ? { preferredChannel: body.preferredChannel }
            : {}),
          ...(body.doNotCall !== undefined ? { doNotCall: body.doNotCall } : {}),
        },
      });
      const changed = Object.keys(body).filter((k) => k !== 'expectedUpdatedAt');
      await this.app.activity.record(tx, {
        type: 'contact_updated',
        contactId: id,
        companyId: body.companyId === undefined ? before.companyId : body.companyId,
        actorId: actor.id,
        summary: `Contact updated (${changed.join(', ')})`,
        refTable: 'contacts',
        refId: id,
        meta: { fields: changed },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.update',
        entity: 'contact',
        entityId: id,
        before: contactToDto(before),
        after: body,
      });
    });
    const dto = await this.get(scope, id);
    this.app.events.emit('entity.changed', {
      type: 'contact',
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
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.contact.update({ where: { id }, data: { deletedAt: now } });
      // release identifiers so the number/email can be re-used (docs/05 contact_phones)
      await tx.contactPhone.updateMany({
        where: { contactId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.contactEmail.updateMany({
        where: { contactId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.delete',
        entity: 'contact',
        entityId: id,
        before: contactToDto(before),
      });
    });
  }

  async restore(scope: VisibilityScope, id: string, ctx: AuditContext): Promise<ContactDto> {
    const row = await this.db.contact.findFirst({
      where: { id, deletedAt: { not: null }, ...scopeWhere(scope, SHAPES.contact) },
      select: { id: true, deletedAt: true },
    });
    if (!row) throw new NotFoundError('Contact');
    const deletedAt = row.deletedAt;
    try {
      await this.db.$transaction(async (tx) => {
        await tx.contact.update({ where: { id }, data: { deletedAt: null } });
        await tx.contactPhone.updateMany({
          where: { contactId: id, deletedAt },
          data: { deletedAt: null },
        });
        await tx.contactEmail.updateMany({
          where: { contactId: id, deletedAt },
          data: { deletedAt: null },
        });
        await this.app.audit.writeWith(tx, ctx, {
          action: 'contact.restore',
          entity: 'contact',
          entityId: id,
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002')
        throw new ConflictError(
          'Cannot restore: a phone number or email now belongs to another contact',
        );
      throw err;
    }
    return this.get(scope, id);
  }

  // ── phones / emails ─────────────────────────────────────────────────────────────────

  async addPhone(
    scope: VisibilityScope,
    actor: Actor,
    contactId: string,
    input: z.infer<typeof phoneInputItem>,
    ctx: AuditContext,
  ): Promise<ContactDto> {
    const contact = await this.getVisible(scope, contactId);
    assertCanWrite(scope, contact.ownerId, actor.id);
    const [phone] = await this.normalizePhones([input]);
    if (!phone) throw new ValidationError([{ path: 'number', message: 'Invalid phone number' }]);
    const dup = await this.findDuplicates({ phones: [phone.e164] });
    if (dup.length > 0)
      throw new DuplicateError('This phone number belongs to another contact', dup);
    const makePrimary = input.isPrimary === true || contact.phones.length === 0;
    await this.db.$transaction(async (tx) => {
      if (makePrimary)
        await tx.contactPhone.updateMany({
          where: { contactId, isPrimary: true },
          data: { isPrimary: false },
        });
      await tx.contactPhone.create({
        data: {
          id: newId(),
          contactId,
          e164: phone.e164,
          raw: phone.raw,
          type: phone.type,
          isPrimary: makePrimary,
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.phone_add',
        entity: 'contact',
        entityId: contactId,
        after: phone,
      });
    });
    return this.get(scope, contactId);
  }

  async updatePhone(
    scope: VisibilityScope,
    actor: Actor,
    contactId: string,
    phoneId: string,
    input: { type?: string | undefined; isPrimary?: boolean | undefined },
    ctx: AuditContext,
  ): Promise<ContactDto> {
    const contact = await this.getVisible(scope, contactId);
    assertCanWrite(scope, contact.ownerId, actor.id);
    if (!contact.phones.some((p) => p.id === phoneId)) throw new NotFoundError('Phone');
    await this.db.$transaction(async (tx) => {
      if (input.isPrimary === true)
        await tx.contactPhone.updateMany({
          where: { contactId, isPrimary: true },
          data: { isPrimary: false },
        });
      await tx.contactPhone.update({
        where: { id: phoneId },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.isPrimary === true ? { isPrimary: true } : {}),
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.phone_update',
        entity: 'contact',
        entityId: contactId,
        after: { phoneId, ...input },
      });
    });
    return this.get(scope, contactId);
  }

  async removePhone(
    scope: VisibilityScope,
    actor: Actor,
    contactId: string,
    phoneId: string,
    ctx: AuditContext,
  ): Promise<ContactDto> {
    const contact = await this.getVisible(scope, contactId);
    assertCanWrite(scope, contact.ownerId, actor.id);
    const phone = contact.phones.find((p) => p.id === phoneId);
    if (!phone) throw new NotFoundError('Phone');
    await this.db.$transaction(async (tx) => {
      await tx.contactPhone.update({
        where: { id: phoneId },
        data: { deletedAt: new Date(), isPrimary: false },
      });
      if (phone.isPrimary) {
        const next = contact.phones.find((p) => p.id !== phoneId);
        if (next)
          await tx.contactPhone.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.phone_remove',
        entity: 'contact',
        entityId: contactId,
        before: phone,
      });
    });
    return this.get(scope, contactId);
  }

  async addEmail(
    scope: VisibilityScope,
    actor: Actor,
    contactId: string,
    input: z.infer<typeof emailInputItem>,
    ctx: AuditContext,
  ): Promise<ContactDto> {
    const contact = await this.getVisible(scope, contactId);
    assertCanWrite(scope, contact.ownerId, actor.id);
    const dup = await this.findDuplicates({ emails: [input.email] });
    if (dup.length > 0) throw new DuplicateError('This email belongs to another contact', dup);
    if (contact.emails.some((e) => e.email.toLowerCase() === input.email))
      throw new ConflictError('Email already on this contact');
    const makePrimary = input.isPrimary === true || contact.emails.length === 0;
    await this.db.$transaction(async (tx) => {
      if (makePrimary)
        await tx.contactEmail.updateMany({
          where: { contactId, isPrimary: true },
          data: { isPrimary: false },
        });
      await tx.contactEmail.create({
        data: { id: newId(), contactId, email: input.email, isPrimary: makePrimary },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.email_add',
        entity: 'contact',
        entityId: contactId,
        after: { email: input.email },
      });
    });
    return this.get(scope, contactId);
  }

  async removeEmail(
    scope: VisibilityScope,
    actor: Actor,
    contactId: string,
    emailId: string,
    ctx: AuditContext,
  ): Promise<ContactDto> {
    const contact = await this.getVisible(scope, contactId);
    assertCanWrite(scope, contact.ownerId, actor.id);
    const email = contact.emails.find((e) => e.id === emailId);
    if (!email) throw new NotFoundError('Email');
    await this.db.$transaction(async (tx) => {
      await tx.contactEmail.update({
        where: { id: emailId },
        data: { deletedAt: new Date(), isPrimary: false },
      });
      if (email.isPrimary) {
        const next = contact.emails.find((e) => e.id !== emailId);
        if (next)
          await tx.contactEmail.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.email_remove',
        entity: 'contact',
        entityId: contactId,
        before: email,
      });
    });
    return this.get(scope, contactId);
  }

  // ── merge ─────────────────────────────────────────────────────────────────────────────

  /** Merge `sourceId` into `targetId`; the target survives with the union of identifiers and history. */
  async merge(
    scope: VisibilityScope,
    actor: Actor,
    targetId: string,
    sourceId: string,
    ctx: AuditContext,
  ): Promise<ContactDto> {
    if (targetId === sourceId) throw new ConflictError('Cannot merge a contact into itself');
    const target = await this.getVisible(scope, targetId);
    const source = await this.getVisible(scope, sourceId);
    assertCanWrite(scope, target.ownerId, actor.id);
    assertCanWrite(scope, source.ownerId, actor.id);
    const now = new Date();

    await this.db.$transaction(async (tx) => {
      const targetPhones = new Set(target.phones.map((p) => p.e164));
      for (const p of source.phones) {
        if (targetPhones.has(p.e164))
          await tx.contactPhone.update({
            where: { id: p.id },
            data: { deletedAt: now, isPrimary: false },
          });
        else
          await tx.contactPhone.update({
            where: { id: p.id },
            data: { contactId: targetId, isPrimary: false },
          });
      }
      const targetEmails = new Set(target.emails.map((e) => e.email.toLowerCase()));
      for (const e of source.emails) {
        if (targetEmails.has(e.email.toLowerCase()))
          await tx.contactEmail.update({
            where: { id: e.id },
            data: { deletedAt: now, isPrimary: false },
          });
        else
          await tx.contactEmail.update({
            where: { id: e.id },
            data: { contactId: targetId, isPrimary: false },
          });
      }
      await tx.call.updateMany({ where: { contactId: sourceId }, data: { contactId: targetId } });
      await tx.conversation.updateMany({
        where: { contactId: sourceId },
        data: { contactId: targetId },
      });
      await tx.deal.updateMany({ where: { contactId: sourceId }, data: { contactId: targetId } });
      await tx.task.updateMany({ where: { contactId: sourceId }, data: { contactId: targetId } });
      await tx.note.updateMany({ where: { contactId: sourceId }, data: { contactId: targetId } });
      await tx.activity.updateMany({
        where: { contactId: sourceId },
        data: { contactId: targetId },
      });
      await tx.lead.updateMany({
        where: { convertedContactId: sourceId },
        data: { convertedContactId: targetId },
      });

      const mergedCustom = {
        ...jsonObject(source.customFields),
        ...jsonObject(target.customFields),
      };
      await tx.contact.update({
        where: { id: targetId },
        data: {
          tags: [...new Set([...target.tags, ...source.tags])],
          customFields: mergedCustom as object,
          companyId: target.companyId ?? source.companyId,
          jobTitle: target.jobTitle ?? source.jobTitle,
          lastName: target.lastName ?? source.lastName,
          displayName: displayNameOf(target.firstName, target.lastName ?? source.lastName),
          doNotCall: target.doNotCall || source.doNotCall,
        },
      });
      await tx.contact.update({ where: { id: sourceId }, data: { deletedAt: now } });
      await this.app.activity.record(tx, {
        type: 'contact_updated',
        contactId: targetId,
        actorId: actor.id,
        summary: `Merged duplicate contact "${source.displayName}"`,
        refTable: 'contacts',
        refId: targetId,
        meta: { mergedFrom: sourceId, mergedName: source.displayName },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'contact.merge',
        entity: 'contact',
        entityId: targetId,
        before: { source: contactToDto(source) },
        after: { sourceId },
      });
    });
    this.app.events.emit('contact.merged', { targetId, sourceId, byUserId: actor.id });
    return this.get(scope, targetId);
  }

  // ── bulk ──────────────────────────────────────────────────────────────────────────────

  async bulk(
    scope: VisibilityScope,
    actor: Actor,
    body: z.infer<typeof bulkContactsBody>,
    ctx: AuditContext,
  ): Promise<{ affected: number; skipped: string[] }> {
    const visible = await this.db.contact.findMany({
      where: { id: { in: body.ids }, ...scopeWhere(scope, SHAPES.contact) },
      select: { id: true, ownerId: true, tags: true },
    });
    const writable = visible.filter(
      (c) => scope.kind !== 'own' || c.ownerId === null || c.ownerId === actor.id,
    );
    const ids = writable.map((c) => c.id);
    const skipped = body.ids.filter((id) => !ids.includes(id));
    if (ids.length === 0) return { affected: 0, skipped };

    await this.db.$transaction(async (tx) => {
      switch (body.action) {
        case 'assign':
          assertCanAssign(actor.canAssign, body.ownerId, actor.id);
          await tx.contact.updateMany({
            where: { id: { in: ids } },
            data: { ownerId: body.ownerId ?? null },
          });
          break;
        case 'tag': {
          const tag = body.tag ?? '';
          for (const c of writable) {
            if (tag && !c.tags.includes(tag))
              await tx.contact.update({ where: { id: c.id }, data: { tags: [...c.tags, tag] } });
          }
          break;
        }
        case 'untag': {
          const tag = body.tag ?? '';
          for (const c of writable) {
            if (tag && c.tags.includes(tag))
              await tx.contact.update({
                where: { id: c.id },
                data: { tags: c.tags.filter((t) => t !== tag) },
              });
          }
          break;
        }
        case 'delete': {
          const now = new Date();
          await tx.contact.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } });
          await tx.contactPhone.updateMany({
            where: { contactId: { in: ids }, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.contactEmail.updateMany({
            where: { contactId: { in: ids }, deletedAt: null },
            data: { deletedAt: now },
          });
          break;
        }
      }
      await this.app.audit.writeWith(tx, ctx, {
        action: `contact.bulk_${body.action}`,
        entity: 'contact',
        after: { ids, ownerId: body.ownerId, tag: body.tag },
      });
    });
    return { affected: ids.length, skipped };
  }

  async setAvatar(
    scope: VisibilityScope,
    actor: Actor,
    id: string,
    key: string | null,
    ctx: AuditContext,
  ): Promise<ContactDto> {
    const before = await this.getVisible(scope, id);
    assertCanWrite(scope, before.ownerId, actor.id);
    await this.db.contact.update({ where: { id }, data: { avatarKey: key } });
    if (before.avatarKey && before.avatarKey !== key)
      await this.app.storage.delete(before.avatarKey).catch(() => undefined);
    await this.app.audit.write(ctx, {
      action: 'contact.avatar',
      entity: 'contact',
      entityId: id,
      after: { key },
    });
    return this.get(scope, id);
  }
}
