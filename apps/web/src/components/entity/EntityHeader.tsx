/**
 * EntityHeader (Component Inventory · Entity components): avatar, name, badges, primary phone
 * with actions, owner and the action row. Shared by the four detail screens.
 */
import { Ellipsis } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { DropdownMenu, type MenuItemDef } from '@/components/ui/Menu';
import { PhoneNumber, type PhoneNumberProps } from '@/components/data/PhoneNumber';
import { cn } from '@/lib/utils';

export interface HeaderAction {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number }>;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

export function EntityHeader({
  title,
  avatar,
  avatarSeed,
  monogramIcon,
  subtitle,
  badges,
  phone,
  actions = [],
  overflowActions = [],
  className,
}: {
  title: string;
  avatar?: string | null;
  avatarSeed?: string;
  monogramIcon?: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  phone?: PhoneNumberProps;
  actions?: HeaderAction[];
  overflowActions?: (MenuItemDef | 'separator')[];
  className?: string;
}) {
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={cn('flex flex-wrap items-start gap-4', className)}>
      {monogramIcon !== undefined ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted">
          {monogramIcon}
        </span>
      ) : (
        <Avatar name={title} seed={avatarSeed ?? title} src={avatar} size={40} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-2xl">{title}</h1>
          {badges}
        </div>
        {subtitle !== undefined && <div className="mt-1 text-base text-muted">{subtitle}</div>}
        {phone !== undefined && (
          <div className="mt-2">
            <PhoneNumber {...phone} layout="inline" actions />
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions.map((a) => (
          <Button
            key={a.id}
            variant={a.variant ?? 'secondary'}
            icon={a.icon as never}
            disabled={a.disabled}
            title={a.title}
            onClick={a.onClick}
          >
            {a.label}
          </Button>
        ))}
        {overflowActions.length > 0 && (
          <>
            <IconButton
              ref={menuRef}
              icon={Ellipsis}
              label="More actions"
              variant="ghost"
              size={32}
              onClick={() => {
                setMenuOpen((o) => !o);
              }}
            />
            <DropdownMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              anchor={menuRef}
              items={overflowActions}
              ariaLabel="More actions"
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Two-column key/value block used on every detail page. */
export function DetailList({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-3 gap-y-2 text-base',
        className,
      )}
    >
      {items.map((i) => (
        <div key={i.label} className="contents">
          <dt className="truncate text-sm text-muted">{i.label}</dt>
          <dd className="min-w-0">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Bordered card used for every side panel and section on the detail screens. */
export function Panel({
  title,
  actions,
  children,
  className,
  note,
  padded = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  note?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={cn('min-w-0 rounded-md border border-border bg-surface', className)}>
      {title !== undefined && (
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <h3 className="min-w-0 flex-1 truncate text-base font-medium">{title}</h3>
          {actions}
        </div>
      )}
      <div className={cn(padded && 'px-3.5 py-3')}>{children}</div>
      {note !== undefined && (
        <p className="mono border-t border-border px-3.5 py-2 text-xs text-faint">{note}</p>
      )}
    </section>
  );
}
