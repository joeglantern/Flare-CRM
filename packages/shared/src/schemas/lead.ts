import { z } from 'zod';
import { LeadSource, LeadStatus, valuesOf } from '../enums.js';
import {
  emailSchema,
  isoDate,
  isoDateTime,
  paginationOffset,
  phoneInput,
  sortParam,
  uuid,
} from './common.js';
import { userRef } from './company.js';
import { customFieldsInput } from './custom-field.js';

export const leadDto = z.object({
  id: uuid,
  firstName: z.string(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  phone: z.string().nullable(),
  phoneDisplay: z.string().nullable(),
  email: z.string().nullable(),
  source: z.enum(valuesOf(LeadSource)),
  sourceRef: z.string().nullable(),
  status: z.enum(valuesOf(LeadStatus)),
  owner: userRef.nullable(),
  ownerId: uuid.nullable(),
  notes: z.string().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  convertedContactId: uuid.nullable(),
  convertedDealId: uuid.nullable(),
  convertedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type LeadDto = z.infer<typeof leadDto>;

export const createLeadBody = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().max(100).nullable().optional(),
    companyName: z.string().trim().max(200).nullable().optional(),
    phone: phoneInput.nullable().optional(),
    email: emailSchema.nullable().optional(),
    source: z.enum(valuesOf(LeadSource)).default('manual'),
    sourceRef: z.string().max(120).nullable().optional(),
    ownerId: uuid.nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    customFields: customFieldsInput.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.phone) || Boolean(v.email), {
    message: 'A phone number or email is required',
    path: ['phone'],
  });
export type CreateLeadBody = z.infer<typeof createLeadBody>;

export const updateLeadBody = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    companyName: z.string().trim().max(200).nullable().optional(),
    phone: phoneInput.nullable().optional(),
    email: emailSchema.nullable().optional(),
    status: z.enum(['new', 'contacted', 'qualified', 'unqualified']).optional(),
    ownerId: uuid.nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    customFields: customFieldsInput.optional(),
    expectedUpdatedAt: isoDateTime.optional(),
  })
  .strict();
export type UpdateLeadBody = z.infer<typeof updateLeadBody>;

export const convertLeadBody = z
  .object({
    /** Link to an existing contact instead of creating one. */
    existingContactId: uuid.optional(),
    createCompany: z.boolean().default(false),
    createDeal: z.boolean().default(true),
    dealTitle: z.string().trim().max(200).optional(),
    dealValue: z.number().min(0).optional(),
    pipelineId: uuid.optional(),
    expectedCloseDate: isoDate.optional(),
    ownerId: uuid.nullable().optional(),
  })
  .strict();
export type ConvertLeadBody = z.infer<typeof convertLeadBody>;

export const convertResult = z.object({
  lead: leadDto,
  contactId: uuid,
  dealId: uuid.nullable(),
  companyId: uuid.nullable(),
});

export const LEAD_SORT = ['createdAt', 'updatedAt', 'firstName', 'status'] as const;
export const listLeadsQuery = paginationOffset.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(valuesOf(LeadStatus)).optional(),
  source: z.enum(valuesOf(LeadSource)).optional(),
  ownerId: uuid.optional(),
  sort: sortParam(LEAD_SORT),
});

export const bulkLeadsBody = z
  .object({
    action: z.enum(['assign', 'delete', 'status']),
    ids: z.array(uuid).min(1).max(500),
    ownerId: uuid.nullable().optional(),
    status: z.enum(['new', 'contacted', 'qualified', 'unqualified']).optional(),
  })
  .strict();
