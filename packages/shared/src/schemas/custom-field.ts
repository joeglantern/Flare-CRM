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

/**
 * What a key may look like, in one place so the form that offers one and the API that refuses one
 * cannot disagree. They did: a label beginning with a digit produced a key the API rejected, and
 * the only sign of it was a validation failure with nothing in the dialog to say which field.
 */
export const CUSTOM_FIELD_KEY = /^[a-z][a-z0-9_]{1,39}$/;
export const CUSTOM_FIELD_KEY_HINT = 'snake_case, 2 to 40 characters, starting with a letter';

/**
 * A key derived from a human label.
 *
 * Returns something the API accepts or nothing at all: a label of "2FA status" becomes
 * `f_2fa_status` rather than `2fa_status`, since a key has to start with a letter, and a label
 * with no letters or digits in it yields an empty string for the caller to treat as "not derivable".
 */
export function customFieldKeyFrom(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base === '') return '';
  const withLetter = /^[a-z]/.test(base) ? base : `f_${base}`;
  const trimmed = withLetter.slice(0, 40).replace(/_+$/, '');
  // One character is a letter but not yet a key; the second character may be an underscore.
  return trimmed.length === 1 ? `${trimmed}_` : trimmed;
}

export const createCustomFieldBody = z
  .object({
    entity: z.enum(valuesOf(CustomFieldEntity)),
    key: z.string().trim().regex(CUSTOM_FIELD_KEY, CUSTOM_FIELD_KEY_HINT),
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
