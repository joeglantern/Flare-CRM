/**
 * Flare mark and wordmark, vector, traced from assets/brand/source/01-brand-sheet.png.
 * The mark is a four-point spark with concave sides, longest point up-right. Solid shape only,
 * so it survives 16 px. Colour comes from `currentColor` unless `tone` is set.
 */
import type { SVGProps } from 'react';
import { FLARE_MARK_PATH } from '@crm/ui';
import { cn } from '@/lib/utils';

// The path lives in the design system so the console draws the same mark; re-exported here
// because the CRM has referred to it by this name since before there was a second product.
export { FLARE_MARK_PATH };

type Tone = 'flare' | 'white' | 'black' | 'current';

const toneColor: Record<Tone, string> = {
  flare: '#FF6A3D',
  white: '#F2F1EF',
  black: '#17171A',
  current: 'currentColor',
};

export interface MarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  tone?: Tone;
  title?: string;
}

export function FlareMark({
  size = 24,
  tone = 'flare',
  title = 'Flare CRM',
  className,
  ...rest
}: MarkProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={cn('shrink-0', className)}
      {...rest}
    >
      <path d={FLARE_MARK_PATH} fill={toneColor[tone]} />
    </svg>
  );
}

export interface WordmarkProps {
  /** height of the capital letters in px; the mark scales with it */
  size?: number;
  withMark?: boolean;
  tone?: Tone;
  className?: string;
}

/**
 * "Flare" in a heavy geometric sans plus small letterspaced "CRM" (docs/18 section 7). Rendered as
 * text in the UI font so it stays crisp and themable; export a path version for print later.
 */
export function FlareWordmark({
  size = 20,
  withMark = true,
  tone = 'current',
  className,
}: WordmarkProps) {
  const color = toneColor[tone];
  return (
    <span
      className={cn('inline-flex items-center gap-[0.45em] leading-none select-none', className)}
      style={{ fontSize: size, color: tone === 'current' ? undefined : color }}
      aria-label="Flare CRM"
    >
      {withMark && (
        <FlareMark
          size={size * 1.25}
          tone={tone === 'current' ? 'flare' : tone}
          title=""
          aria-hidden
        />
      )}
      <span className="font-extrabold tracking-[-0.03em]" style={{ fontSize: '1.15em' }}>
        Flare
      </span>
      <span className="font-medium tracking-[0.22em] text-muted" style={{ fontSize: '0.55em' }}>
        CRM
      </span>
    </span>
  );
}
