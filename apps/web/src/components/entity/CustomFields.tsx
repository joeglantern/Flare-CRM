/**
 * CustomFieldsPanel and CustomFieldInput (Component Inventory · Entity components).
 * One component covers all eleven field types, so adding a field needs no frontend change.
 */
import type { CustomFieldDefinitionDto } from '@crm/shared';
import { Sparkles } from 'lucide-react';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Toggle';
import { Tag } from '@/components/ui/Badge';
import { DateTime } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { cn } from '@/lib/utils';

export type CustomFieldValues = Record<string, unknown>;

/** What a controlled input should show for an unknown JSON value: text, a number, or nothing. */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

export function CustomFieldInput({
  definition,
  value,
  onChange,
  error,
}: {
  definition: CustomFieldDefinitionDto;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const label = definition.label;
  const common = { label, error, required: definition.required };

  switch (definition.type) {
    case 'textarea':
      return (
        <Textarea
          {...common}
          value={asString(value)}
          onChange={(e) => {
            onChange(e.target.value === '' ? null : e.target.value);
          }}
        />
      );
    case 'number':
      return (
        <Input
          {...common}
          type="number"
          value={asString(value)}
          onChange={(e) => {
            onChange(e.target.value === '' ? null : Number(e.target.value));
          }}
        />
      );
    case 'date':
    case 'datetime':
      return (
        <Input
          {...common}
          type={definition.type === 'date' ? 'date' : 'datetime-local'}
          value={asString(value).slice(0, definition.type === 'date' ? 10 : 16)}
          onChange={(e) => {
            onChange(e.target.value === '' ? null : e.target.value);
          }}
        />
      );
    case 'boolean':
      return (
        <Checkbox
          checked={value === true}
          onChange={(v) => {
            onChange(v);
          }}
          label={label}
        />
      );
    case 'select':
      return (
        <Select
          {...common}
          value={asString(value) === '' ? null : asString(value)}
          onChange={(v) => {
            onChange(v);
          }}
          options={(definition.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
        />
      );
    case 'multiselect': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            {label}
            {definition.required && <span className="ml-0.5 text-danger">*</span>}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(definition.options ?? []).map((o) => {
              const on = list.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    onChange(on ? list.filter((v) => v !== o.value) : [...list, o.value]);
                  }}
                  className={cn(
                    'h-7 rounded-full border px-2.5 text-sm',
                    on
                      ? 'border-flare bg-[var(--flare-subtle)] text-flare-on'
                      : 'border-strong text-text hover:bg-hover',
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {error !== undefined && <span className="text-sm text-danger">{error}</span>}
        </div>
      );
    }
    case 'url':
    case 'email':
    case 'phone':
    case 'text':
    default:
      return (
        <Input
          {...common}
          type={definition.type === 'url' ? 'url' : definition.type === 'email' ? 'email' : 'text'}
          mono={definition.type === 'phone'}
          value={asString(value)}
          onChange={(e) => {
            onChange(e.target.value === '' ? null : e.target.value);
          }}
        />
      );
  }
}

export function CustomFieldsForm({
  definitions,
  values,
  onChange,
  errors,
  className,
}: {
  definitions: CustomFieldDefinitionDto[];
  values: CustomFieldValues;
  onChange: (v: CustomFieldValues) => void;
  errors?: Record<string, string>;
  className?: string;
}) {
  const active = definitions.filter((d) => d.isActive);
  if (active.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted">
        <Sparkles size={13} aria-hidden />
        Custom fields
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {active.map((d) => (
          <CustomFieldInput
            key={d.id}
            definition={d}
            value={values[d.key]}
            error={errors?.[`customFields.${d.key}`]}
            onChange={(v) => {
              onChange({ ...values, [d.key]: v });
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function CustomFieldsPanel({
  definitions,
  values,
  className,
  note,
}: {
  definitions: CustomFieldDefinitionDto[];
  values: CustomFieldValues;
  className?: string;
  note?: string;
}) {
  const active = definitions.filter((d) => d.isActive);
  if (active.length === 0) return null;
  return (
    <section className={cn('rounded-md border border-border bg-surface', className)}>
      <h2 className="flex items-center gap-1.5 border-b border-border px-3.5 py-2.5 text-base font-medium">
        <Sparkles size={13} className="text-muted" aria-hidden />
        Custom fields
      </h2>
      <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-2 px-3.5 py-3 text-base">
        {active.map((d) => (
          <div key={d.id} className="contents">
            <dt className="truncate text-sm text-muted">{d.label}</dt>
            <dd className="min-w-0">
              <CustomFieldValue definition={d} value={values[d.key]} />
            </dd>
          </div>
        ))}
      </dl>
      {note !== undefined && (
        <p className="border-t border-border px-3.5 py-2 text-xs text-faint">{note}</p>
      )}
    </section>
  );
}

/** Custom field values arrive as unknown JSON, so this is the only place that stringifies one. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function CustomFieldValue({
  definition,
  value,
}: {
  definition: CustomFieldDefinitionDto;
  value: unknown;
}) {
  if (value === null || value === undefined || value === '')
    return <span className="text-faint">—</span>;
  switch (definition.type) {
    case 'boolean':
      return <span>{value === true ? 'Yes' : 'No'}</span>;
    case 'date':
    case 'datetime':
      return (
        <DateTime value={asText(value)} mode="absolute" showTime={definition.type === 'datetime'} />
      );
    case 'url':
      return (
        <a href={asText(value)} target="_blank" rel="noreferrer noopener" className="truncate">
          {asText(value).replace(/^https?:\/\//, '')}
        </a>
      );
    case 'email':
      return <a href={`mailto:${asText(value)}`}>{asText(value)}</a>;
    case 'phone':
      return <PhoneNumber e164={asText(value)} />;
    case 'select': {
      const opt = (definition.options ?? []).find((o) => o.value === value);
      return <span>{opt?.label ?? asText(value)}</span>;
    }
    case 'multiselect': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="flex flex-wrap gap-1">
          {list.map((v) => (
            <Tag key={v}>{(definition.options ?? []).find((o) => o.value === v)?.label ?? v}</Tag>
          ))}
        </span>
      );
    }
    default:
      return <span className="break-words">{asText(value)}</span>;
  }
}
