import { z } from 'zod';
import { ContactSource, PhoneType, valuesOf } from '../enums.js';
import {
  emailSchema,
  isoDateTime,
  paginationOffset,
  phoneInput,
  sortParam,
  uuid,
} from './common.js';
import { companyRef, userRef } from './company.js';
import { customFieldsInput } from './custom-field.js';

export const contactPhoneDto = z.object({
  id: uuid,
  e164: z.string(),
  raw: z.string(),
  display: z.string(),
  type: z.enum(valuesOf(PhoneType)),
  isPrimary: z.boolean(),
});
export const contactEmailDto = z.object({ id: uuid, email: z.string(), isPrimary: z.boolean() });

export const contactDto = z.object({
  id: uuid,
  firstName: z.string(),
  lastName: z.string().nullable(),
  displayName: z.string(),
  company: companyRef.nullable(),
  companyId: uuid.nullable(),
  jobTitle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  owner: userRef.nullable(),
  ownerId: uuid.nullable(),
  source: z.enum(valuesOf(ContactSource)),
  tags: z.array(z.string()),
  customFields: z.record(z.string(), z.unknown()),
  preferredChannel: z.string().nullable(),
  doNotCall: z.boolean(),
  phones: z.array(contactPhoneDto),
  emails: z.array(contactEmailDto),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
});
export type ContactDto = z.infer<typeof contactDto>;

/** Compact form for lists, pops and references. */
export const contactSummaryDto = z.object({
  id: uuid,
  displayName: z.string(),
  company: companyRef.nullable(),
  primaryPhone: z.string().nullable(),
  primaryEmail: z.string().nullable(),
  ownerId: uuid.nullable(),
  avatarUrl: z.string().nullable(),
  tags: z.array(z.string()),
  doNotCall: z.boolean(),
  updatedAt: isoDateTime,
});
export type ContactSummaryDto = z.infer<typeof contactSummaryDto>;

export const phoneInputItem = z
  .object({
    number: phoneInput,
    type: z.enum(valuesOf(PhoneType)).default('mobile'),
    isPrimary: z.boolean().optional(),
  })
  .strict();
export const emailInputItem = z
  .object({ email: emailSchema, isPrimary: z.boolean().optional() })
  .strict();

const tagSchema = z.string().trim().min(1).max(40);

export const createContactBody = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().max(100).nullable().optional(),
    companyId: uuid.nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    ownerId: uuid.nullable().optional(),
    source: z.enum(valuesOf(ContactSource)).default('manual'),
    tags: z.array(tagSchema).max(30).default([]),
    customFields: customFieldsInput.optional(),
    preferredChannel: z.enum(['call', 'whatsapp', 'sms', 'email']).nullable().optional(),
    doNotCall: z.boolean().default(false),
    phones: z.array(phoneInputItem).max(10).default([]),
    emails: z.array(emailInputItem).max(10).default([]),
    /** Link an existing call (unknown-caller popup → create contact). */
    linkCallId: uuid.optional(),
  })
  .strict();
export type CreateContactBody = z.infer<typeof createContactBody>;

export const updateContactBody = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    companyId: uuid.nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    ownerId: uuid.nullable().optional(),
    tags: z.array(tagSchema).max(30).optional(),
    customFields: customFieldsInput.optional(),
    preferredChannel: z.enum(['call', 'whatsapp', 'sms', 'email']).nullable().optional(),
    doNotCall: z.boolean().optional(),
    expectedUpdatedAt: isoDateTime.optional(),
  })
  .strict();
export type UpdateContactBody = z.infer<typeof updateContactBody>;

export const CONTACT_SORT = ['displayName', 'createdAt', 'updatedAt'] as const;
export const listContactsQuery = paginationOffset.extend({
  q: z.string().trim().max(120).optional(),
  ownerId: uuid.optional(),
  companyId: uuid.optional(),
  tag: tagSchema.optional(),
  source: z.enum(valuesOf(ContactSource)).optional(),
  doNotCall: z.enum(['true', 'false']).optional(),
  sort: sortParam(CONTACT_SORT),
});

export const duplicatesQuery = z
  .object({ phone: phoneInput.optional(), email: emailSchema.optional() })
  .refine((v) => v.phone !== undefined || v.email !== undefined, {
    message: 'phone or email is required',
  });

export const duplicateMatch = z.object({
  contact: contactSummaryDto,
  matchedOn: z.enum(['phone', 'email']),
  value: z.string(),
});

export const mergeContactsBody = z.object({ sourceId: uuid }).strict();

export const bulkContactsBody = z
  .object({
    action: z.enum(['assign', 'tag', 'untag', 'delete']),
    ids: z.array(uuid).min(1).max(500),
    ownerId: uuid.nullable().optional(),
    tag: tagSchema.optional(),
  })
  .strict()
  .refine((v) => (v.action === 'assign' ? v.ownerId !== undefined : true), {
    message: 'ownerId required',
    path: ['ownerId'],
  })
  .refine((v) => (v.action === 'tag' || v.action === 'untag' ? v.tag !== undefined : true), {
    message: 'tag required',
    path: ['tag'],
  });

export const bulkResult = z.object({ affected: z.number().int(), skipped: z.array(uuid) });
