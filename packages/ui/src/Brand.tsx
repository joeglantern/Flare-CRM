/**
 * The Flare mark, in the design system so both products draw the same one.
 *
 * It is a four-point spark with concave sides, longest point up and to the right, traced from the
 * brand sheet. One solid shape and no strokes, which is what lets it survive at 16px in a browser
 * tab. Colour comes from `currentColor` unless a tone is named, so it inherits whatever it sits in.
 */
import type { SVGProps } from 'react';
import { cn } from './utils.js';

export const FLARE_MARK_PATH =
  'M93 5 C70.9 38.9 70.1 53.6 89 72 C58.9 66.4 42.1 71.6 13 96 C30.4 64.9 28.6 49.1 5 24 C39.8 36.3 59.2 32.2 93 5 Z';

export type FlareTone = 'flare' | 'white' | 'black' | 'current';

const toneColor: Record<FlareTone, string> = {
  flare: '#FF6A3D',
  white: '#F2F1EF',
  black: '#17171A',
  current: 'currentColor',
};

export interface FlareMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  tone?: FlareTone;
  title?: string;
}

export function FlareMark({
  size = 24,
  tone = 'flare',
  title = 'Flare',
  className,
  ...rest
}: FlareMarkProps) {
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
