import {
  createNoteBody,
  cursorListResponse,
  dataResponse,
  idParams,
  listNotesQuery,
  noteDto,
  updateNoteBody,
  type NoteDto,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { decodeCursor, pageOf } from '../../lib/pagination.js';
import { auditContext } from '../../lib/request.js';
import { SHAPES, scopeOf, scopeWhere } from '../../lib/scope.js';
import { hasRole } from '../../plugins/authorize.js';

const noteSelect = {
  id: true,
  body: true,
  authorId: true,
  author: { select: { id: true, name: true } },
  contactId: true,
  dealId: true,
  companyId: true,
  callId: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
  attachments: {
    select: { id: true, key: true, fileName: true, mimeType: true, sizeBytes: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.NoteSelect;

function toDto(r: Prisma.NoteGetPayload<{ select: typeof noteSelect }>): NoteDto {
  return {
    ...r,
    attachments: r.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: Number(a.sizeBytes),
      url: `/api/v1/files/${encodeURIComponent(a.key)}`,
    })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const notesRoutes: FastifyPluginAsyncZod = async (app) => {
  /** A note is visible when at least one of its parents is visible to the caller. */
  const parentVisibility = (scope: Parameters<typeof scopeWhere>[0]): Prisma.NoteWhereInput =>
    scope.kind === 'all'
      ? {}
      : {
          OR: [
            { contact: scopeWhere(scope, SHAPES.contact) },
            { deal: scopeWhere(scope, SHAPES.deal) },
            { company: scopeWhere(scope, SHAPES.company) },
            { call: scopeWhere(scope, SHAPES.call) },
            ...(scope.kind === 'own' ? [{ authorId: scope.userId }] : []),
          ],
        };

  const assertParents = async (
    scope: Parameters<typeof scopeWhere>[0],
    b: {
      contactId?: string | undefined;
      dealId?: string | undefined;
      companyId?: string | undefined;
      callId?: string | undefined;
    },
  ) => {
    if (
      b.contactId &&
      !(await app.db.contact.findFirst({
        where: { id: b.contactId, ...scopeWhere(scope, SHAPES.contact) },
        select: { id: true },
      }))
    )
      throw new ValidationError([{ path: 'contactId', message: 'Contact not found' }]);
    if (
      b.dealId &&
      !(await app.db.deal.findFirst({
        where: { id: b.dealId, ...(scopeWhere(scope, SHAPES.deal) as Prisma.DealWhereInput) },
        select: { id: true },
      }))
    )
      throw new ValidationError([{ path: 'dealId', message: 'Deal not found' }]);
    if (
      b.companyId &&
      !(await app.db.company.findFirst({
        where: { id: b.companyId, ...scopeWhere(scope, SHAPES.company) },
        select: { id: true },
      }))
    )
      throw new ValidationError([{ path: 'companyId', message: 'Company not found' }]);
    if (
      b.callId &&
      !(await app.db.call.findFirst({
        where: { id: b.callId, ...(scopeWhere(scope, SHAPES.call) as Prisma.CallWhereInput) },
        select: { id: true },
      }))
    )
      throw new ValidationError([{ path: 'callId', message: 'Call not found' }]);
  };

  app.get('/notes', {
    config: { auth: { permission: 'note:read' } },
    schema: {
      tags: ['notes'],
      querystring: listNotesQuery,
      response: { 200: cursorListResponse(noteDto) },
    },
    handler: async (request) => {
      const { scope } = await scopeOf(app, request);
      const q = request.query;
      const cursor = decodeCursor(q.cursor);
      const rows = await app.db.note.findMany({
        where: {
          AND: [
            parentVisibility(scope),
            ...(q.contactId ? [{ contactId: q.contactId }] : []),
            ...(q.dealId ? [{ dealId: q.dealId }] : []),
            ...(q.companyId ? [{ companyId: q.companyId }] : []),
            ...(q.callId ? [{ callId: q.callId }] : []),
            ...(cursor
              ? [
                  {
                    OR: [
                      { createdAt: { lt: cursor.at } },
                      { createdAt: cursor.at, id: { lt: cursor.id } },
                    ],
                  },
                ]
              : []),
          ],
        },
        select: noteSelect,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      });
      const page = pageOf(rows, q.limit, (r) => r.createdAt);
      return { data: page.data.map(toDto), page: page.page };
    },
  });

  app.post('/notes', {
    config: { auth: { permission: 'note:create' } },
    schema: { tags: ['notes'], body: createNoteBody, response: { 201: dataResponse(noteDto) } },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      const b = request.body;
      await assertParents(scope, b);
      const id = newId();
      let companyId = b.companyId ?? null;
      if (!companyId && b.contactId)
        companyId =
          (
            await app.db.contact.findUnique({
              where: { id: b.contactId },
              select: { companyId: true },
            })
          )?.companyId ?? null;
      await app.db.$transaction(async (tx) => {
        await tx.note.create({
          data: {
            id,
            body: b.body,
            authorId: actor.id,
            contactId: b.contactId ?? null,
            dealId: b.dealId ?? null,
            companyId: b.companyId ?? null,
            callId: b.callId ?? null,
            pinned: b.pinned,
          },
        });
        if (b.attachmentIds && b.attachmentIds.length > 0) {
          // Only the caller's own unbound uploads: an id from someone else, or one already
          // attached elsewhere, is silently skipped rather than moved.
          await tx.attachment.updateMany({
            where: {
              id: { in: b.attachmentIds },
              noteId: null,
              messageId: null,
              uploadedById: actor.id,
            },
            data: { noteId: id },
          });
        }
        await app.activity.record(tx, {
          type: 'note',
          contactId: b.contactId ?? null,
          dealId: b.dealId ?? null,
          companyId,
          actorId: actor.id,
          summary: b.body.length > 140 ? `${b.body.slice(0, 137)}…` : b.body,
          refTable: 'notes',
          refId: id,
          meta: { text: b.body.slice(0, 2000), callId: b.callId ?? null },
        });
        await app.audit.writeWith(tx, auditContext(request), {
          action: 'note.create',
          entity: 'note',
          entityId: id,
          after: { ...b, body: b.body.slice(0, 200) },
        });
      });
      const row = await app.db.note.findUniqueOrThrow({ where: { id }, select: noteSelect });
      return reply.status(201).send({ data: toDto(row) });
    },
  });

  app.patch('/notes/:id', {
    config: { auth: { permission: 'note:update' } },
    schema: {
      tags: ['notes'],
      params: idParams,
      body: updateNoteBody,
      response: { 200: dataResponse(noteDto) },
    },
    handler: async (request) => {
      const { actor, scope } = await scopeOf(app, request);
      const before = await app.db.note.findFirst({
        where: { id: request.params.id, ...parentVisibility(scope) },
        select: noteSelect,
      });
      if (!before) throw new NotFoundError('Note');
      if (
        before.authorId !== actor.id &&
        !hasRole(actor.role, 'admin') &&
        !hasRole(actor.role, 'manager')
      )
        throw new ForbiddenError('Only the author can edit this note');
      await app.db.$transaction(async (tx) => {
        await tx.note.update({
          where: { id: before.id },
          data: {
            ...(request.body.body !== undefined ? { body: request.body.body } : {}),
            ...(request.body.pinned !== undefined ? { pinned: request.body.pinned } : {}),
          },
        });
        if (request.body.body !== undefined) {
          await tx.activity.updateMany({
            where: { refTable: 'notes', refId: before.id },
            data: {
              summary:
                request.body.body.length > 140
                  ? `${request.body.body.slice(0, 137)}…`
                  : request.body.body,
              meta: { text: request.body.body.slice(0, 2000), callId: before.callId, edited: true },
            },
          });
        }
        await app.audit.writeWith(tx, auditContext(request), {
          action: 'note.update',
          entity: 'note',
          entityId: before.id,
          before: { body: before.body.slice(0, 200), pinned: before.pinned },
          after: request.body,
        });
      });
      return {
        data: toDto(
          await app.db.note.findUniqueOrThrow({ where: { id: before.id }, select: noteSelect }),
        ),
      };
    },
  });

  app.delete('/notes/:id', {
    config: { auth: { permission: 'note:delete' } },
    schema: { tags: ['notes'], params: idParams, response: { 204: z.null() } },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      const before = await app.db.note.findFirst({
        where: { id: request.params.id, ...parentVisibility(scope) },
        select: noteSelect,
      });
      if (!before) throw new NotFoundError('Note');
      if (
        before.authorId !== actor.id &&
        !hasRole(actor.role, 'admin') &&
        !hasRole(actor.role, 'manager')
      )
        throw new ForbiddenError('Only the author can delete this note');
      await app.db.$transaction(async (tx) => {
        await tx.note.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
        await tx.activity.deleteMany({ where: { refTable: 'notes', refId: before.id } });
        await app.audit.writeWith(tx, auditContext(request), {
          action: 'note.delete',
          entity: 'note',
          entityId: before.id,
          before: { body: before.body.slice(0, 200) },
        });
      });
      return reply.status(204).send(null);
    },
  });
};

export default notesRoutes;
