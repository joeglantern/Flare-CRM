/**
 * The two marks a time series is made of, and the gradient under it. Shared by the sparkline and
 * the trend chart so both animate identically: the area rises into place while the line draws
 * itself on over it.
 *
 * Motion here is a CSS transition on an inline style rather than a JavaScript loop. The browser
 * then owns the tween, nothing re-renders while it runs, and a reader who has asked for less
 * movement is handed the final frame by passing `shown` as true from the first paint.
 */
import { AREA_OPACITY, ink, motion, RISE_PX } from './style.js';

export function AreaGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={AREA_OPACITY} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

export function AreaMark({
  d,
  fill,
  shown,
  delay = 0,
}: {
  d: string;
  fill: string;
  shown: boolean;
  delay?: number;
}) {
  return (
    <path
      d={d}
      fill={fill}
      stroke="none"
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : `translateY(${RISE_PX}px)`,
        transition: `opacity ${motion.rise}ms ${motion.ease} ${delay}ms, transform ${motion.rise}ms ${motion.ease} ${delay}ms`,
      }}
    />
  );
}

/**
 * A series line. A solid one pays its own length out as a dash, which reads as the line being
 * drawn; a dashed one cannot do that without fighting its own pattern, so it fades in instead.
 */
export function LineMark({
  d,
  color,
  dash,
  shown,
  width = 2,
  dashed = false,
  delay = 0,
}: {
  d: string;
  color: string;
  /** An upper bound on the path's length, from `dashLength`. */
  dash: number;
  shown: boolean;
  width?: number;
  dashed?: boolean;
  delay?: number;
}) {
  if (dashed) {
    return (
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeDasharray="5 4"
        strokeLinecap="round"
        style={{
          opacity: shown ? 1 : 0,
          transition: `opacity ${motion.rise}ms ${motion.ease} ${delay}ms`,
        }}
      />
    );
  }
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        strokeDasharray: dash,
        strokeDashoffset: shown ? 0 : dash,
        transition: `stroke-dashoffset ${motion.draw}ms ${motion.ease} ${delay}ms`,
      }}
    />
  );
}

/** The hairline the series stands on. The only line in this kit that is not data. */
export function Baseline({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return <line x1={x1} x2={x2} y1={y} y2={y} stroke={ink.baseline} strokeWidth={1} />;
}

/**
 * A reference the series is read against: a plan's cap, or a projection of where it is heading.
 * Dashed and faint, because it is not something that was measured.
 */
export function ContextRule({
  x1,
  x2,
  y,
  label,
  align = 'end',
}: {
  x1: number;
  x2: number;
  y: number;
  label?: string;
  align?: 'start' | 'end';
}) {
  return (
    <g>
      <line
        x1={x1}
        x2={x2}
        y1={y}
        y2={y}
        stroke={ink.context}
        strokeWidth={1}
        strokeDasharray="3 4"
      />
      {label !== undefined && (
        <text
          x={align === 'end' ? x2 : x1}
          y={y - 5}
          textAnchor={align === 'end' ? 'end' : 'start'}
          fontSize={10}
          fill={ink.context}
        >
          {label}
        </text>
      )}
    </g>
  );
}
