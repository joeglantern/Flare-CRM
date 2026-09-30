/**
 * Hover and focus tooltip (Component Inventory · Primitives). Used for E.164 numbers, permission
 * reasons and truncated text. Positioned in a portal so it escapes table overflow.
 *
 * The side asked for is a preference. The tooltip is measured before it is shown and flips to the
 * opposite side when it would not fit, then is kept inside the window: a tooltip on the top bar
 * asked for "top" and rendered above the top of the screen, where nobody could read it.
 */
import {
  cloneElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { placeTooltip, type TooltipSide as Side } from './utils';

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
  const tip = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (disabled === true) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setOpen(true);
    }, delay);
  }, [delay, disabled]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  // Measured before paint, so the tooltip is never seen in the wrong place first.
  useLayoutEffect(() => {
    if (!open) return;
    const a = anchor.current;
    const t = tip.current;
    if (!a || !t) return;
    const r = a.getBoundingClientRect();
    const size = t.getBoundingClientRect();
    const placed = placeTooltip(
      side,
      r,
      { width: size.width, height: size.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ top: placed.top, left: placed.left });
  }, [open, side, content]);

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
        'aria-describedby': open ? id : undefined,
      } as never)}
      {open &&
        createPortal(
          <span
            ref={tip}
            id={id}
            role="tooltip"
            style={
              pos === null
                ? { top: 0, left: 0, visibility: 'hidden' }
                : { top: pos.top, left: pos.left }
            }
            className="fade-in pointer-events-none fixed z-[100] max-w-[280px] rounded-sm bg-text px-2 py-1 text-sm text-bg shadow-float"
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
}
