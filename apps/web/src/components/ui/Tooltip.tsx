/**
 * Hover and focus tooltip (Component Inventory · Primitives). Used for E.164 numbers, permission
 * reasons and truncated text. Positioned in a portal so it escapes table overflow.
 */
import {
  cloneElement,
  useCallback,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

type Side = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<{ ref?: Ref<HTMLElement>; 'aria-describedby'?: string }>;
  side?: Side;
  delay?: number;
  /** Skip rendering entirely when there is nothing to say. */
  disabled?: boolean;
}

export function Tooltip({ content, children, side = 'top', delay = 250, disabled }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  // Defined here rather than inline in JSX so it is a stable callback and not a render-time read.
  const setAnchor = useCallback((node: HTMLElement | null) => {
    anchor.current = node;
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (disabled === true) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 8;
      const map: Record<Side, { top: number; left: number }> = {
        top: { top: r.top - gap, left: r.left + r.width / 2 },
        bottom: { top: r.bottom + gap, left: r.left + r.width / 2 },
        left: { top: r.top + r.height / 2, left: r.left - gap },
        right: { top: r.top + r.height / 2, left: r.right + gap },
      };
      setPos(map[side]);
    }, delay);
  }, [delay, disabled, side]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  }, []);

  const translate: Record<Side, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

  if (disabled === true) return children;

  return (
    <>
      {/* eslint-disable-next-line react-hooks/refs -- setAnchor is a ref callback handed to the child, not a read */}
      {cloneElement(children, {
        ref: setAnchor,
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
        'aria-describedby': pos ? id : undefined,
      } as never)}
      {pos !== null &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ top: pos.top, left: pos.left, transform: translate[side] }}
            className="fade-in pointer-events-none fixed z-[100] max-w-[280px] rounded-sm bg-text px-2 py-1 text-sm text-bg shadow-float"
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
}
