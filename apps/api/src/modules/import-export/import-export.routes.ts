/**
 * CSV import (BullMQ job) and streamed CSV export (R-7.1.5). Exports respect visibility scope
 * and are audited with the row count (docs/08 K2).
 */
import {
  dataResponse,
  exportParams,
  exportQuery,
  idParams,
  importJobDto,
  importMapping,
  listImportsQuery,
  offsetListResponse,
  roleHasPermission,
  type ImportJobDto,
} from '@crm/shared';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { csvStream, parseCsv } from '../../lib/csv.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { auditContext, requireUser } from '../../lib/request.js';
import { SHAPES, scopeOf, scopeWhere } from '../../lib/scope.js';
import { storeUpload } from '../../lib/uploads.js';
import { QUEUES } from '../../jobs/queues.js';

const CSV_TYPES = new Set(['text/csv', 'text/plain']);

function toDto(r: {
  id: string;
  entity: string;
  status: string;
  totalRows: number;
  processedRows: number;
  createdRows: number;
  updatedRows: number;
  errorRows: number;
  errors: unknown;
  createdAt: Date;
  finishedAt: Date | null;
}): ImportJobDto {
  return {
    id: r.id,
    entity: r.entity as ImportJobDto['entity'],
    status: r.status as ImportJobDto['status'],
    totalRows: r.totalRows,
    processedRows: r.processedRows,
    createdRows: r.createdRows,
    updatedRows: r.updatedRows,
    errorRows: r.errorRows,
    errors: Array.isArray(r.errors) ? (r.errors as ImportJobDto['errors']) : [],
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

function dateRange(
  from: string | undefined,
  to: string | undefined,
): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
}

const importExportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/imports', {
    config: {
      auth: { permission: ['contact:import'], feature: 'imports' },
      rateLimit: { max: 10, timeWindow: '10 minutes' },
    },
    schema: { tags: ['import-export'], response: { 202: dataResponse(importJobDto) } },
    handler: async (request, reply) => {
      const user = requireUser(request);
      let file: MultipartFile | undefined;
      let buffer: Buffer | undefined;
      const fields: Record<string, string> = {};
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (file) throw new BadRequestError('Only one file allowed');
          buffer = await part.toBuffer(); // multipart parts must be consumed in order
          file = part;
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
      if (!file || !buffer) throw new BadRequestError('A CSV file is required');
      const fileBuffer = buffer;
      const entity = z.enum(['contact', 'company', 'lead']).safeParse(fields.entity);
      if (!entity.success)
        throw new ValidationError([
          { path: 'entity', message: 'entity must be contact, company or lead' },
        ]);
      if (entity.data === 'lead' && !roleHasPermission(user.role ?? 'agent', 'lead:import'))
        throw new ForbiddenError();
      let mapping: z.infer<typeof importMapping>;
      try {
        mapping = importMapping.parse(JSON.parse(fields.mapping ?? '{}'));
      } catch (err) {
        throw new ValidationError([
          { path: 'mapping', message: err instanceof Error ? err.message : 'Invalid mapping' },
        ]);
      }
      const stored = await storeUpload(
        app.storage,
        Object.assign(file, { toBuffer: () => Promise.resolve(fileBuffer) }),
        { prefix: 'imports', allowed: CSV_TYPES, maxBytes: 25 * 1024 * 1024 },
      );
      const parsed = parseCsv(fileBuffer, 0);
      const unknownColumns = Object.keys(mapping.columns).filter(
        (c) => !parsed.headers.includes(c),
      );
      if (unknownColumns.length > 0)
        throw new ValidationError([
          { path: 'mapping.columns', message: `Columns not in file: ${unknownColumns.join(', ')}` },
        ]);

      const id = newId();
      const job = await app.db.importJob.create({
        data: {
          id,
          entity: entity.data,
          fileKey: stored.key,
          status: 'queued',
          mapping: mapping as object,
          createdById: user.id,
        },
      });
      await app.queues.add(
        QUEUES.csvImport,
        'import',
        { importJobId: id },
        { jobId: `import-${id}`, attempts: 1 },
      );
      await app.audit.write(auditContext(request), {
        action: 'import.create',
        entity: 'import_job',
        entityId: id,
        after: { entity: entity.data, file: stored.fileName, size: stored.size },
      });
      return reply.status(202).send({ data: toDto(job) });
    },
  });

  app.get('/imports', {
    config: { auth: { permission: 'contact:import', feature: 'imports' } },
    schema: {
      tags: ['import-export'],
      querystring: listImportsQuery,
      response: { 200: offsetListResponse(importJobDto) },
    },
    handler: async (request) => {
      const user = requireUser(request);
      const where = roleHasPermission(user.role ?? 'agent', 'audit:read')
        ? {}
        : { createdById: user.id };
      const [rows, total] = await Promise.all([
        app.db.importJob.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (request.query.page - 1) * request.query.pageSize,
          take: request.query.pageSize,
        }),
        app.db.importJob.count({ where }),
      ]);
      return {
        data: rows.map(toDto),
        page: { page: request.query.page, pageSize: request.query.pageSize, total },
      };
    },
  });

  app.get('/imports/:id', {
    config: { auth: { permission: 'contact:import', feature: 'imports' } },
    schema: {
      tags: ['import-export'],
      params: idParams,
      response: { 200: dataResponse(importJobDto) },
    },
    handler: async (request) => {
      const user = requireUser(request);
      const row = await app.db.importJob.findFirst({
        where: {
          id: request.params.id,
          ...(roleHasPermission(user.role ?? 'agent', 'audit:read')
            ? {}
            : { createdById: user.id }),
        },
      });
      if (!row) throw new NotFoundError('Import');
      return { data: toDto(row) };
    },
  });

  app.get('/exports/:entity', {
    config: {
      auth: { authenticated: true, feature: 'exports' },
      rateLimit: { max: 10, timeWindow: '10 minutes' },
    },
    schema: { tags: ['import-export'], params: exportParams, querystring: exportQuery, hide: true },
    handler: async (request, reply) => {
      const { actor, scope } = await scopeOf(app, request);
      const entity = request.params.entity;
      const perm = (
        {
          contacts: 'contact:export',
          companies: 'company:export',
          leads: 'lead:read',
          deals: 'deal:export',
          tasks: 'task:read',
          calls: 'call:export',
        } as const
      )[entity];
      if (!roleHasPermission(actor.role, perm)) throw new ForbiddenError();
      const q = request.query;
      const range = dateRange(q.from, q.to);

      let headers: string[] = [];
      let rows: unknown[][] = [];
      switch (entity) {
        case 'contacts': {
          const list = await app.db.contact.findMany({
            where: {
              AND: [
                scopeWhere(scope, SHAPES.contact),
                ...(q.ownerId ? [{ ownerId: q.ownerId }] : []),
                ...(q.q ? [{ displayName: { contains: q.q, mode: 'insensitive' as const } }] : []),
              ],
            },
            select: {
              firstName: true,
              lastName: true,
              jobTitle: true,
              tags: true,
              doNotCall: true,
              source: true,
              createdAt: true,
              company: { select: { name: true } },
              owner: { select: { name: true } },
              phones: { where: { deletedAt: null }, select: { e164: true } },
              emails: { where: { deletedAt: null }, select: { email: true } },
            },
            orderBy: { displayName: 'asc' },
            take: 50_000,
          });
          headers = [
            'firstName',
            'lastName',
            'phones',
            'emails',
            'company',
            'jobTitle',
            'owner',
            'tags',
            'doNotCall',
            'source',
            'createdAt',
          ];
          rows = list.map((c) => [
            c.firstName,
            c.lastName,
            c.phones.map((p) => p.e164).join('; '),
            c.emails.map((e) => e.email).join('; '),
            c.company?.name,
            c.jobTitle,
            c.owner?.name,
            c.tags.join('; '),
            c.doNotCall,
            c.source,
            c.createdAt,
          ]);
          break;
        }
        case 'companies': {
          const list = await app.db.company.findMany({
            where: {
              AND: [
                scopeWhere(scope, SHAPES.company),
                ...(q.q ? [{ name: { contains: q.q, mode: 'insensitive' as const } }] : []),
              ],
            },
            select: {
              name: true,
              industry: true,
              website: true,
              phoneE164: true,
              email: true,
              createdAt: true,
              owner: { select: { name: true } },
            },
            orderBy: { name: 'asc' },
            take: 50_000,
          });
          headers = ['name', 'industry', 'website', 'phone', 'email', 'owner', 'createdAt'];
          rows = list.map((c) => [
            c.name,
            c.industry,
            c.website,
            c.phoneE164,
            c.email,
            c.owner?.name,
            c.createdAt,
          ]);
          break;
        }
        case 'leads': {
          const list = await app.db.lead.findMany({
            where: {
              AND: [
                scopeWhere(scope, SHAPES.lead) as Prisma.LeadWhereInput,
                ...(range ? [{ createdAt: range }] : []),
              ],
            },
            select: {
              firstName: true,
              lastName: true,
              companyName: true,
              phoneE164: true,
              email: true,
              source: true,
              status: true,
              createdAt: true,
              owner: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50_000,
          });
          headers = [
            'firstName',
            'lastName',
            'companyName',
            'phone',
            'email',
            'source',
            'status',
            'owner',
            'createdAt',
          ];
          rows = list.map((l) => [
            l.firstName,
            l.lastName,
            l.companyName,
            l.phoneE164,
            l.email,
            l.source,
            l.status,
            l.owner?.name,
            l.createdAt,
          ]);
          break;
        }
        case 'deals': {
          const list = await app.db.deal.findMany({
            where: {
              AND: [
                scopeWhere(scope, SHAPES.deal) as Prisma.DealWhereInput,
                ...(range ? [{ createdAt: range }] : []),
              ],
            },
            select: {
              title: true,
              status: true,
              value: true,
              currency: true,
              probability: true,
              expectedCloseDate: true,
              createdAt: true,
              wonAt: true,
              lostAt: true,
              lostReason: true,
              stage: { select: { name: true } },
              contact: { select: { displayName: true } },
              company: { select: { name: true } },
              owner: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50_000,
          });
          headers = [
            'title',
            'contact',
            'company',
            'stage',
            'status',
            'value',
            'currency',
            'probability',
            'expectedCloseDate',
            'owner',
            'createdAt',
            'wonAt',
            'lostAt',
            'lostReason',
          ];
          rows = list.map((d) => [
            d.title,
            d.contact?.displayName,
            d.company?.name,
            d.stage.name,
            d.status,
            Number(d.value),
            d.currency,
            d.probability,
            d.expectedCloseDate?.toISOString().slice(0, 10),
            d.owner?.name,
            d.createdAt,
            d.wonAt,
            d.lostAt,
            d.lostReason,
          ]);
          break;
        }
        case 'tasks': {
          const list = await app.db.task.findMany({
            where: {
              AND: [
                scopeWhere(scope, SHAPES.task) as Prisma.TaskWhereInput,
                ...(range ? [{ dueAt: range }] : []),
              ],
            },
            select: {
              title: true,
              type: true,
              status: true,
              priority: true,
              dueAt: true,
              completedAt: true,
              assignee: { select: { name: true } },
              contact: { select: { displayName: true } },
            },
            orderBy: { dueAt: 'asc' },
            take: 50_000,
          });
          headers = [
            'title',
            'type',
            'status',
            'priority',
            'dueAt',
            'assignee',
            'contact',
            'completedAt',
          ];
          rows = list.map((t) => [
            t.title,
            t.type,
            t.status,
            t.priority,
            t.dueAt,
            t.assignee?.name,
            t.contact?.displayName,
            t.completedAt,
          ]);
          break;
        }
        case 'calls': {
          const list = await app.db.call.findMany({
            where: {
              AND: [
                scope.kind === 'all'
                  ? {}
                  : {
                      OR: [
                        scopeWhere(scope, SHAPES.call) as Prisma.CallWhereInput,
                        { contact: scopeWhere(scope, SHAPES.contact) },
                      ],
                    },
                ...(range ? [{ startedAt: range }] : []),
              ],
            },
            select: {
              startedAt: true,
              direction: true,
              status: true,
              externalE164: true,
              extension: true,
              ringDurationSec: true,
              talkDurationSec: true,
              totalDurationSec: true,
              dispositionNote: true,
              recordingStatus: true,
              contact: { select: { displayName: true } },
              user: { select: { name: true } },
              disposition: { select: { name: true } },
            },
            orderBy: { startedAt: 'desc' },
            take: 50_000,
          });
          headers = [
            'startedAt',
            'direction',
            'status',
            'number',
            'contact',
            'agent',
            'extension',
            'ringSec',
            'talkSec',
            'totalSec',
            'disposition',
            'note',
            'recording',
          ];
          rows = list.map((c) => [
            c.startedAt,
            c.direction,
            c.status,
            c.externalE164,
            c.contact?.displayName,
            c.user?.name,
            c.extension,
            c.ringDurationSec,
            c.talkDurationSec,
            c.totalDurationSec,
            c.disposition?.name,
            c.dispositionNote,
            c.recordingStatus === 'stored' ? 'yes' : 'no',
          ]);
          break;
        }
      }
      await app.audit.write(auditContext(request), {
        action: 'export',
        entity,
        after: { rows: rows.length, filters: q },
      });
      void reply.header('content-type', 'text/csv; charset=utf-8');
      void reply.header(
        'content-disposition',
        `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      void reply.header('cache-control', 'private, no-store');
      const iter = (async function* () {
        for (const r of rows) yield r;
      })();
      return reply.send(csvStream(headers, iter));
    },
  });
};

export default importExportRoutes;
