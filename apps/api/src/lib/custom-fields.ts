import { FEATURES } from '@crm/shared';
/**
 * Dynamic validation of `customFields` JSON against active CustomFieldDefinition rows (R-7.1.2).
 * Unknown keys are rejected; inactive definitions are ignored on write but preserved on read.
 */
import type { CustomFieldEntity, CustomFieldType } from '@crm/shared';
import { z } from 'zod';
import { ValidationError, FeatureNotInPlanError } from './errors.js';
import type { Db } from '../plugins/prisma.js';

interface Definition {
  key: string;
  type: CustomFieldType;
  options: unknown;
  required: boolean;
}

function optionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) =>
    o && typeof o === 'object' && 'value' in o
      ? String((o as { value: unknown }).value)
      : String(o),
  );
}

function fieldSchema(def: Definition): z.ZodType {
  let s: z.ZodType;
  switch (def.type) {
    case 'text':
      s = z.string().max(500);
      break;
    case 'textarea':
      s = z.string().max(10_000);
      break;
    case 'number':
      s = z.number();
      break;
    case 'date':
      s = z.iso.date();
      break;
    case 'datetime':
      s = z.iso.datetime({ offset: true });
      break;
    case 'boolean':
      s = z.boolean();
      break;
    case 'select': {
      const values = optionValues(def.options);
      s = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.never();
      break;
    }
    case 'multiselect': {
      const values = optionValues(def.options);
      s = z.array(values.length > 0 ? z.enum(values as [string, ...string[]]) : z.never()).max(50);
      break;
    }
    case 'url':
      s = z.url().max(500);
      break;
    case 'phone':
      s = z.string().max(32);
      break;
    case 'email':
      s = z.email().max(254);
      break;
  }
  return def.required ? s : s.nullable().optional();
}

export function buildCustomFieldsSchema(defs: Definition[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const d of defs) shape[d.key] = fieldSchema(d);
  return z.object(shape).strict();
}

export class CustomFieldsValidator {
  private inPlan: () => Promise<boolean> = () => Promise.resolve(true);

  constructor(private readonly db: Db) {}

  /** Set once entitlements exist; until then every value is accepted. */
  setFeatureGate(inPlan: () => Promise<boolean>): void {
    this.inPlan = inPlan;
  }

  async definitions(entity: CustomFieldEntity): Promise<Definition[]> {
    const rows = await this.db.customFieldDefinition.findMany({
      where: { entity, isActive: true },
      select: { key: true, type: true, options: true, required: true },
    });
    return rows.map((r) => ({
      key: r.key,
      type: r.type as CustomFieldType,
      options: r.options,
      required: r.required,
    }));
  }

  /**
   * Validate an incoming object. For partial updates pass `existing` so required fields already
   * present are not re-demanded.
   */
  async validate(
    entity: CustomFieldEntity,
    input: Record<string, unknown> | undefined,
    existing?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const defs = await this.definitions(entity);
    if (input === undefined) return existing ?? {};
    if (Object.keys(input).length > 0 && !(await this.inPlan())) {
      throw new FeatureNotInPlanError('custom_fields', FEATURES.custom_fields.label);
    }
    const merged = { ...(existing ?? {}), ...input };
    const result = buildCustomFieldsSchema(defs).safeParse(merged);
    if (!result.success) {
      throw new ValidationError(
        result.error.issues.map((i) => ({
          path: `customFields.${i.path.join('.')}`,
          message: i.message,
        })),
      );
    }
    // strip nulls for tidiness
    return Object.fromEntries(
      Object.entries(result.data).filter(([, v]) => v !== null && v !== undefined),
    );
  }
}
