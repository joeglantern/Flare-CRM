import { z } from 'zod';
import { isoDateTime, uuid } from './common.js';

export const webFormField = z
  .object({
    key: z
      .enum(['firstName', 'lastName', 'companyName', 'phone', 'email', 'notes'])
      .or(z.string().regex(/^cf:[a-z][a-z0-9_]{1,39}$/)),
    label: z.string().trim().min(1).max(80),
    required: z.boolean().default(false),
  })
  .strict();

export const webFormDto = z.object({
  id: uuid,
  name: z.string(),
  token: z.string(),
  fields: z.array(webFormField),
  allowedOrigins: z.array(z.string()),
  defaultOwnerId: uuid.nullable(),
  isActive: z.boolean(),
  submissionsCount: z.number().int(),
  submitUrl: z.string(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type WebFormDto = z.infer<typeof webFormDto>;

export const createWebFormBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    fields: z.array(webFormField).min(1).max(20),
    allowedOrigins: z.array(z.url().max(200)).max(10).default([]),
    defaultOwnerId: uuid.nullable().optional(),
  })
  .strict();

export const updateWebFormBody = createWebFormBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict();

/** Public submission: field values by key + honeypot. Unknown keys are rejected. */
export const publicSubmissionBody = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    companyName: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(32).optional(),
    email: z.email().max(254).optional(),
    notes: z.string().trim().max(2000).optional(),
    customFields: z.record(z.string().max(40), z.string().max(500)).optional(),
    /** Honeypot: must stay empty. */
    website: z.string().max(200).optional(),
  })
  .strict();
export type PublicSubmissionBody = z.infer<typeof publicSubmissionBody>;
