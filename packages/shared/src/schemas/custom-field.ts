import { z } from 'zod';
import { CustomFieldEntity, CustomFieldType, valuesOf } from '../enums.js';
import { isoDateTime, uuid } from './common.js';

export const customFieldOption = z.object({
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
});

export const customFieldDefinitionDto = z.object({
  id: uuid,
  entity: z.enum(valuesOf(CustomFieldEntity)),
  key: z.string(),
  label: z.string(),
  type: z.enum(valuesOf(CustomFieldType)),
  options: z.array(customFieldOption).nullable(),
  required: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type CustomFieldDefinitionDto = z.infer<typeof customFieldDefinitionDto>;

export const createCustomFieldBody = z
  .object({
    entity: z.enum(valuesOf(CustomFieldEntity)),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, 'snake_case, 2–40 chars, starting with a letter'),
    label: z.string().trim().min(1).max(80),
    type: z.enum(valuesOf(CustomFieldType)),
    options: z.array(customFieldOption).min(1).max(100).optional(),
    required: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => (v.type === 'select' || v.type === 'multiselect' ? v.options !== undefined : true),
    {
      message: 'options are required for select/multiselect fields',
      path: ['options'],
    },
  );

export const updateCustomFieldBody = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    options: z.array(customFieldOption).min(1).max(100).optional(),
    required: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const reorderBody = z.object({ ids: z.array(uuid).min(1).max(200) }).strict();

/** Arbitrary JSON object for custom field values; validated dynamically server-side. */
export const customFieldsInput = z.record(z.string().max(40), z.unknown()).default({});
