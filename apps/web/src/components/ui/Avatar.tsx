/**
 * Avatar (Component Inventory · Primitives). Falls back to an abstract placeholder from the brand
 * set, chosen deterministically from the id — never initials, per the brand brief.
 * Sizes: 20 table · 24 list · 32 header · 40 popup · 56 profile.
 */
import { cn } from '@/lib/utils';

export type Presence =
  'available' | 'ringing' | 'on_call' | 'unregistered' | 'no_extension' | 'offline';

const PRESENCE_COLOR: Record<Presence, string> = {
  available: 'bg-success',
  ringing: 'bg-flare',
  on_call: 'bg-warning',
  unregistered: 'bg-[var(--text-faint)]',
  no_extension: 'bg-danger',
  offline: 'bg-[var(--text-faint)]',
};

export const PRESENCE_LABEL: Record<Presence, string> = {
  available: 'Available',
  ringing: 'Ringing',
  on_call: 'On a call',
  unregistered: 'Phone unregistered',
  no_extension: 'No extension',
  offline: 'Offline',
};

/** 16 abstract placeholders; the same entity always lands on the same one. */
export function placeholderAvatar(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (Math.abs(h) % 16) + 1;
  return `/brand/avatars/abstract-${String(n).padStart(2, '0')}.png`;
}

export interface AvatarProps {
  /** Server-provided avatar URL; falls back to the abstract placeholder. */
  src?: string | null;
  /** Used for alt text and, with `seed`, for choosing the placeholder. */
  name: string;
  seed?: string;
  size?: 18 | 20 | 24 | 32 | 40 | 56;
  presence?: Presence | null;
  className?: string;
}

export function Avatar({ src, name, seed, size = 24, presence, className }: AvatarProps) {
  const url =
    src !== null && src !== undefined && src !== '' ? src : placeholderAvatar(seed ?? name);
  const dot = size >= 32 ? 10 : 8;
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        className="h-full w-full rounded-full bg-hover object-cover"
      />
      {presence !== null && presence !== undefined && (
        <i
          title={PRESENCE_LABEL[presence]}
          style={{ width: dot, height: dot }}
          className={cn(
            'absolute -right-px -bottom-px rounded-full border-2 border-surface',
            PRESENCE_COLOR[presence],
          )}
        />
      )}
    </span>
  );
}

/** Overlapping avatar row with a "+N" overflow chip. */
export function AvatarStack({
  people,
  max = 3,
  size = 24,
}: {
  people: { id: string; name: string; avatarUrl?: string | null }[];
  max?: number;
  size?: 18 | 20 | 24 | 32;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <Avatar
          key={p.id}
          name={p.name}
          seed={p.id}
          src={p.avatarUrl ?? null}
          size={size}
          className={cn('rounded-full ring-2 ring-[var(--surface)]', i > 0 && '-ml-2')}
        />
      ))}
      {rest > 0 && (
        <span
          style={{ width: size, height: size }}
          className="-ml-2 inline-flex items-center justify-center rounded-full bg-hover text-2xs font-medium ring-2 ring-[var(--surface)]"
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
