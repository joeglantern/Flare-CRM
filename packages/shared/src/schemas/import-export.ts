import { z } from 'zod';
import { ImportEntity, ImportStatus, valuesOf } from '../enums.js';
import { isoDateTime, paginationOffset, uuid } from './common.js';

export const importMapping = z
  .object({
    /** CSV header → target field (e.g. "Phone" → "phone", "First Name" → "firstName", "cf:segment" for custom fields). */
    columns: z.record(z.string().max(120), z.string().max(80)),
    onDuplicate: z.enum(['skip', 'update']).default('skip'),
    ownerId: uuid.nullable().optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
    /** Optional default country override for phone parsing. */
    country: z.string().length(2).optional(),
  })
  .strict();
export type ImportMapping = z.infer<typeof importMapping>;

export const importJobDto = z.object({
  id: uuid,
  entity: z.enum(valuesOf(ImportEntity)),
  status: z.enum(valuesOf(ImportStatus)),
  totalRows: z.number().int(),
  processedRows: z.number().int(),
  createdRows: z.number().int(),
  updatedRows: z.number().int(),
  errorRows: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
  createdAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});
export type ImportJobDto = z.infer<typeof importJobDto>;

export const listImportsQuery = paginationOffset;

export const exportQuery = z.object({
  q: z.string().trim().max(120).optional(),
  ownerId: uuid.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

export const EXPORTABLE = ['contacts', 'companies', 'leads', 'deals', 'tasks', 'calls'] as const;
export const exportParams = z.object({ entity: z.enum(EXPORTABLE) });

/** Fields accepted by the importer per entity (value = human label). */
export const IMPORT_FIELDS = {
  contact: {
    firstName: 'First name',
    lastName: 'Last name',
    phone: 'Phone',
    phone2: 'Second phone',
    email: 'Email',
    company: 'Company name',
    jobTitle: 'Job title',
    tags: 'Tags (; separated)',
    source: 'Source',
    doNotCall: 'Do not call',
  },
  company: {
    name: 'Name',
    industry: 'Industry',
    website: 'Website',
    phone: 'Phone',
    email: 'Email',
    city: 'City',
    country: 'Country',
  },
  lead: {
    firstName: 'First name',
    lastName: 'Last name',
    companyName: 'Company',
    phone: 'Phone',
    email: 'Email',
    source: 'Source',
    notes: 'Notes',
  },
} as const;
