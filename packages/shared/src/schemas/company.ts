import { z } from 'zod';
import {
  emailSchema,
  isoDateTime,
  paginationOffset,
  phoneInput,
  sortParam,
  uuid,
} from './common.js';
import { customFieldsInput } from './custom-field.js';

export const addressSchema = z
  .object({
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    region: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().length(2).optional(),
  })
  .strict();

export const userRef = z.object({ id: uuid, name: z.string() });
export const companyRef = z.object({ id: uuid, name: z.string() });

export const companyDto = z.object({
  id: uuid,
  name: z.string(),
  industry: z.string().nullable(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  phoneDisplay: z.string().nullable(),
  email: z.string().nullable(),
  address: addressSchema.nullable(),
  owner: userRef.nullable(),
  ownerId: uuid.nullable(),
  customFields: z.record(z.string(), z.unknown()),
  contactCount: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
});
export type CompanyDto = z.infer<typeof companyDto>;

export const createCompanyBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    industry: z.string().trim().max(100).nullable().optional(),
    website: z.url().max(300).nullable().optional(),
    phone: phoneInput.nullable().optional(),
    email: emailSchema.nullable().optional(),
    address: addressSchema.nullable().optional(),
    ownerId: uuid.nullable().optional(),
    customFields: customFieldsInput.optional(),
  })
  .strict();
export type CreateCompanyBody = z.infer<typeof createCompanyBody>;

export const updateCompanyBody = createCompanyBody
  .partial()
  .extend({ expectedUpdatedAt: isoDateTime.optional() })
  .strict();
export type UpdateCompanyBody = z.infer<typeof updateCompanyBody>;

export const COMPANY_SORT = ['name', 'createdAt', 'updatedAt'] as const;
export const listCompaniesQuery = paginationOffset.extend({
  q: z.string().trim().max(120).optional(),
  ownerId: uuid.optional(),
  industry: z.string().max(100).optional(),
  sort: sortParam(COMPANY_SORT),
});
