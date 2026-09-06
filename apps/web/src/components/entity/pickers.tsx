/**
 * OwnerPicker, ContactPicker and CompanyPicker (Component Inventory · Entity components).
 * Async entity pickers: the company picker can create inline, the contact picker shows the phone
 * so two people with the same name can be told apart.
 */
import { Building2, Check, ChevronsUpDown, Plus, Search, UserRound, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { FieldShell } from '@/components/ui/Input';
import { Popover } from '@/components/ui/Menu';
import { Spinner } from '@/components/ui/Loading';
import { useCompanies, useCompanyMutations, useCompanySearch } from '@/features/companies/api';
import { useContact, useContactSearch } from '@/features/contacts/api';
import { useAssignableUsers } from '@/features/users/api';
import { formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';

interface PickerShellProps {
  label?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder: string;
  allowClear?: boolean;
  onClear?: () => void;
  selected: React.ReactNode | null;
  children: (close: () => void) => React.ReactNode;
  className?: string;
}

function PickerShell({
  label,
  error,
  required,
  disabled,
  placeholder,
  allowClear,
  onClear,
  selected,
  children,
  className,
}: PickerShellProps) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <FieldShell label={label} error={error} required={required} className={className}>
      <div className="flex items-center gap-1">
        <button
          ref={anchor}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-list`}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => {
            setOpen((o) => !o);
          }}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm border bg-bg px-2.5 text-left text-base',
            error !== undefined && error !== '' ? 'border-danger' : 'border-strong',
            disabled === true && 'cursor-not-allowed text-faint',
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', selected === null && 'text-faint')}>
            {selected ?? placeholder}
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-muted" aria-hidden />
        </button>
        {allowClear === true && selected !== null && onClear !== undefined && (
          <IconButton icon={X} label="Clear" size={28} variant="ghost" onClick={onClear} />
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} matchWidth>
        {children(() => {
          setOpen(false);
        })}
      </Popover>
    </FieldShell>
  );
}

export function OwnerPicker({
  value,
  onChange,
  label = 'Owner',
  allowClear = true,
  error,
  required,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  allowClear?: boolean;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const users = useAssignableUsers();
  const [q, setQ] = useState('');
  const selected = (users.data ?? []).find((u) => u.id === value) ?? null;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) => needle === '' || u.name.toLowerCase().includes(needle));
  }, [users.data, q]);

  return (
    <PickerShell
      label={label}
      error={error}
      required={required}
      disabled={disabled}
      className={className}
      placeholder="Unassigned"
      allowClear={allowClear}
      onClear={() => {
        onChange(null);
      }}
      selected={
        selected === null ? null : (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={selected.name} seed={selected.id} src={selected.avatarUrl} size={18} />
            <span className="truncate">{selected.name}</span>
          </span>
        )
      }
    >
      {(close) => (
        <>
          <SearchRow
            value={q}
            onChange={setQ}
            loading={users.isPending}
            placeholder="Search people"
          />
          <button
            type="button"
            onClick={() => {
              onChange(null);
              close();
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
          >
            <span className="flex h-[18px] w-[18px] items-center justify-center text-muted">
              <UserRound size={13} aria-hidden />
            </span>
            <span className="flex-1">Unassigned</span>
            {value === null && <Check size={14} className="text-flare" aria-hidden />}
          </button>
          {shown.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                onChange(u.id);
                close();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
            >
              <Avatar name={u.name} seed={u.id} src={u.avatarUrl} size={18} />
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.extension !== null && (
                <span className="mono shrink-0 text-sm text-muted">{u.extension}</span>
              )}
              {u.id === value && <Check size={14} className="shrink-0 text-flare" aria-hidden />}
            </button>
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-3 text-center text-sm text-muted">No people match.</p>
          )}
        </>
      )}
    </PickerShell>
  );
}

export function ContactPicker({
  value,
  onChange,
  label = 'Contact',
  allowClear = true,
  error,
  required,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  allowClear?: boolean;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const search = useContactSearch(q);
  const current = useContact(value);
  const selected = current.data ?? null;

  return (
    <PickerShell
      label={label}
      error={error}
      required={required}
      disabled={disabled}
      className={className}
      placeholder="Search for a contact"
      allowClear={allowClear}
      onClear={() => {
        onChange(null);
      }}
      selected={
        selected === null ? null : (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar
              name={selected.displayName}
              seed={selected.id}
              src={selected.avatarUrl}
              size={18}
            />
            <span className="truncate">{selected.displayName}</span>
          </span>
        )
      }
    >
      {(close) => (
        <>
          <SearchRow
            value={q}
            onChange={setQ}
            loading={search.isFetching}
            placeholder="Name, company or number"
          />
          {(search.data ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                close();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
            >
              <Avatar name={c.displayName} seed={c.id} src={c.avatarUrl} size={18} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.displayName}</span>
                {c.company != null && (
                  <span className="block truncate text-sm text-muted">{c.company.name}</span>
                )}
              </span>
              {c.primaryPhone != null && (
                <span className="mono shrink-0 text-sm text-muted">
                  {formatPhone(c.primaryPhone)}
                </span>
              )}
            </button>
          ))}
          {q.trim().length < 2 && (
            <p className="px-2 py-3 text-center text-sm text-muted">
              Type at least two characters.
            </p>
          )}
          {q.trim().length >= 2 && (search.data ?? []).length === 0 && !search.isFetching && (
            <p className="px-2 py-3 text-center text-sm text-muted">No contacts match.</p>
          )}
        </>
      )}
    </PickerShell>
  );
}

export function CompanyPicker({
  value,
  onChange,
  label = 'Company',
  allowCreate = true,
  allowClear = true,
  error,
  required,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  allowCreate?: boolean;
  allowClear?: boolean;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const search = useCompanySearch(q);
  const all = useCompanies({ pageSize: 20 }, q.trim().length < 2);
  const { create } = useCompanyMutations();
  const list = q.trim().length >= 2 ? (search.data ?? []) : (all.data?.data ?? []);
  const selected = list.find((c) => c.id === value) ?? null;
  const currentName = selected?.name;

  return (
    <PickerShell
      label={label}
      error={error}
      required={required}
      disabled={disabled}
      className={className}
      placeholder="No company"
      allowClear={allowClear}
      onClear={() => {
        onChange(null);
      }}
      selected={
        value === null ? null : (
          <span className="flex min-w-0 items-center gap-2">
            <Building2 size={14} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate">{currentName ?? 'Selected company'}</span>
          </span>
        )
      }
    >
      {(close) => (
        <>
          <SearchRow
            value={q}
            onChange={setQ}
            loading={search.isFetching}
            placeholder="Search companies"
          />
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                close();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
            >
              <Building2 size={14} className="shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.id === value && <Check size={14} className="shrink-0 text-flare" aria-hidden />}
            </button>
          ))}
          {allowCreate &&
            q.trim().length >= 2 &&
            !list.some((c) => c.name.toLowerCase() === q.trim().toLowerCase()) && (
              <Button
                variant="ghost"
                icon={Plus}
                full
                loading={create.isPending}
                className="mt-1 justify-start"
                onClick={() => {
                  create.mutate(
                    { name: q.trim() },
                    {
                      onSuccess: (c) => {
                        onChange(c.id);
                        close();
                      },
                    },
                  );
                }}
              >
                Create “{q.trim()}”
              </Button>
            )}
        </>
      )}
    </PickerShell>
  );
}

function SearchRow({
  value,
  onChange,
  loading,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  loading: boolean;
  placeholder: string;
}) {
  return (
    <div className="mb-1 flex items-center gap-2 border-b border-border px-2 pb-1.5">
      <Search size={14} className="shrink-0 text-muted" aria-hidden />
      <input
        autoFocus
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 w-full bg-transparent text-base outline-none placeholder:text-faint"
      />
      {loading && <Spinner />}
    </div>
  );
}
