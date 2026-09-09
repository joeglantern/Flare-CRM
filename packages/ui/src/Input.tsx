/**
 * Text input, password input and textarea (Component Inventory · Primitives).
 * `error` is a string, not a boolean, because every server 422 comes back with a message per field.
 */
import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  type ForwardedRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './utils.js';

export interface FieldShellProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  /** Rendered to the right of the label, e.g. a character counter. */
  aside?: ReactNode;
}

export function FieldShell({
  label,
  description,
  error,
  required,
  htmlFor,
  className,
  children,
  aside,
}: FieldShellProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {(label !== undefined || aside !== undefined) && (
        <div className="flex items-baseline gap-2">
          {label !== undefined && (
            <label htmlFor={htmlFor} className="text-sm font-medium">
              {label}
              {required === true && <span className="ml-0.5 text-danger">*</span>}
            </label>
          )}
          {aside !== undefined && <span className="ml-auto text-xs text-faint">{aside}</span>}
        </div>
      )}
      {children}
      {error !== undefined && error !== '' ? (
        <span className="flex items-center gap-1 text-sm text-danger">
          <CircleAlert size={12} className="shrink-0" aria-hidden />
          {error}
        </span>
      ) : (
        description !== undefined && <span className="text-sm text-faint">{description}</span>
      )}
    </div>
  );
}

export const inputBox =
  'h-8 w-full min-w-0 rounded-sm border bg-bg px-2.5 text-base outline-none placeholder:text-faint disabled:cursor-not-allowed disabled:border-border disabled:bg-surface disabled:text-faint';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: ReactNode;
  description?: ReactNode;
  error?: string | undefined;
  prefix?: ReactNode;
  suffix?: ReactNode;
  mono?: boolean;
  aside?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef(function Input(
  {
    label,
    description,
    error,
    prefix,
    suffix,
    mono,
    required,
    className,
    containerClassName,
    aside,
    id,
    ...rest
  }: InputProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const invalid = error !== undefined && error !== '';
  const field = (
    <input
      ref={ref}
      id={inputId}
      required={required}
      aria-invalid={invalid || undefined}
      className={cn(
        inputBox,
        invalid ? 'border-danger' : 'border-strong focus-visible:border-flare',
        mono === true && 'mono',
        (prefix !== undefined || suffix !== undefined) && 'border-0 bg-transparent px-0',
        className,
      )}
      {...rest}
    />
  );
  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      required={required}
      htmlFor={inputId}
      aside={aside}
      className={containerClassName}
    >
      {prefix !== undefined || suffix !== undefined ? (
        <div
          className={cn(
            'flex h-8 items-center gap-2 rounded-sm border bg-bg px-2.5',
            invalid ? 'border-danger' : 'border-strong focus-within:border-flare',
          )}
        >
          {prefix !== undefined && <span className="shrink-0 text-muted">{prefix}</span>}
          {field}
          {suffix !== undefined && <span className="shrink-0 text-muted">{suffix}</span>}
        </div>
      ) : (
        field
      )}
    </FieldShell>
  );
});

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  showStrength?: boolean;
  rules?: { label: string; met: boolean }[];
}

export function PasswordInput({ showStrength, rules, value, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const text = typeof value === 'string' ? value : '';
  const met = rules?.filter((r) => r.met).length ?? 0;
  const score = showStrength === true ? strengthOf(text) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        {...rest}
        value={value}
        type={visible ? 'text' : 'password'}
        suffix={
          <button
            type="button"
            onClick={() => {
              setVisible((v) => !v);
            }}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className="text-muted hover:text-text"
          >
            {visible ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          </button>
        }
      />
      {showStrength === true && (
        <div className="flex items-center gap-2">
          <div className="flex h-1 flex-1 gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full',
                  i < score
                    ? score <= 1
                      ? 'bg-danger'
                      : score === 2
                        ? 'bg-warning'
                        : 'bg-success'
                    : 'bg-[var(--border)]',
                )}
              />
            ))}
          </div>
          <span className="text-xs text-muted">
            {['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score]}
          </span>
        </div>
      )}
      {rules !== undefined && rules.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {rules.map((r) => (
            <li key={r.label} className={r.met ? 'text-success' : 'text-faint'}>
              {r.met ? '✓' : '·'} {r.label}
            </li>
          ))}
          <li className="sr-only">
            {String(met)} of {String(rules.length)} rules met
          </li>
        </ul>
      )}
    </div>
  );
}

function strengthOf(v: string): 0 | 1 | 2 | 3 | 4 {
  if (v.length < 12) return v.length === 0 ? 0 : 1;
  let s = 1;
  if (v.length >= 16) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/\d/.test(v) || /[^\w\s]/.test(v)) s++;
  return Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  description?: ReactNode;
  error?: string | undefined;
  /** Grows with the content up to this many rows. */
  maxRows?: number;
}

export const Textarea = forwardRef(function Textarea(
  {
    label,
    description,
    error,
    className,
    maxRows = 12,
    rows = 3,
    maxLength,
    value,
    id,
    ...rest
  }: TextareaProps,
  ref: ForwardedRef<HTMLTextAreaElement>,
) {
  const auto = useId();
  const areaId = id ?? auto;
  const invalid = error !== undefined && error !== '';
  const text = typeof value === 'string' ? value : '';
  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      htmlFor={areaId}
      aside={maxLength !== undefined ? `${String(text.length)} / ${String(maxLength)}` : undefined}
    >
      <textarea
        ref={ref}
        id={areaId}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-invalid={invalid || undefined}
        style={{ maxHeight: maxRows * 20 + 16 }}
        className={cn(
          'w-full resize-y rounded-sm border bg-bg px-2.5 py-2 text-base leading-relaxed outline-none placeholder:text-faint',
          invalid ? 'border-danger' : 'border-strong focus-visible:border-flare',
          className,
        )}
        {...rest}
      />
    </FieldShell>
  );
});
