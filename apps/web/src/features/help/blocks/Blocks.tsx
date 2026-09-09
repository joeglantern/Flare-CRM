/**
 * One renderer per block type (docs/22). Everything reads from the typed content, so a chapter
 * cannot describe a figure that does not exist or a permission matrix that has drifted.
 */
import { Link } from '@tanstack/react-router';
import { CircleAlert, Info, TriangleAlert, CircleCheck } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Kbd } from '@/components/ui/Kbd';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { DIAGRAMS } from '../diagrams';
import { permissionRows } from '../content/blocks';
import { parseInline } from '../content/inline';
import { chapterById } from '../content';
import type { Block } from '../content/types';
import figures from '../content/figures.json';

const FIGURES = figures as Record<string, { width: number; height: number }>;

export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, i) => {
        if (token.kind === 'kbd') return <Kbd key={i}>{token.value}</Kbd>;
        if (token.kind === 'em')
          return (
            <em key={i} className="font-medium not-italic text-text">
              {token.value}
            </em>
          );
        return <Fragment key={i}>{token.value}</Fragment>;
      })}
    </>
  );
}

type CalloutTone = Extract<Block, { type: 'callout' }>['tone'];

const CALLOUT: Record<CalloutTone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'bg-[var(--info-subtle)]' },
  warning: { icon: TriangleAlert, className: 'bg-[var(--warning-subtle)]' },
  danger: { icon: CircleAlert, className: 'bg-[var(--danger-subtle)]' },
  success: { icon: CircleCheck, className: 'bg-[var(--success-subtle)]' },
};

/**
 * Screenshots are captured in both themes, so the manual shows the product as the reader has it
 * rather than a light screenshot glowing in a dark page. Printing always uses the light one.
 */
function Figure({
  chapterId,
  name,
  alt,
  caption,
}: {
  chapterId: string;
  name: string;
  alt: string;
  caption?: string;
}) {
  const resolved = useTheme((s) => s.resolved);
  const base = `/help/${chapterId}/${name}`;
  const size = FIGURES[`${chapterId}/${name}`];
  // The manifest is written by scripts/capture-help-figures.mjs. A figure that has not been
  // captured yet is left out rather than rendered as a broken image: the surrounding prose
  // stands on its own, and the content test fails loudly if a captured figure goes missing.
  if (size === undefined) return null;
  return (
    <figure className="my-4">
      <picture>
        <source type="image/avif" srcSet={`${base}-${resolved}.avif`} media="screen" />
        <source type="image/webp" srcSet={`${base}-${resolved}.webp`} media="screen" />
        <source type="image/avif" srcSet={`${base}-light.avif`} />
        <img
          src={`${base}-light.png`}
          alt={alt}
          width={size.width}
          height={size.height}
          loading="lazy"
          decoding="async"
          className="w-full rounded-md border border-border"
        />
      </picture>
      {caption !== undefined && (
        <figcaption className="mt-1.5 text-sm text-muted">{caption}</figcaption>
      )}
    </figure>
  );
}

export function BlockView({ block, chapterId }: { block: Block; chapterId: string }): ReactNode {
  switch (block.type) {
    case 'p':
      return (
        <p className="my-2.5 max-w-[68ch] text-md leading-[1.65]">
          <Inline text={block.text} />
        </p>
      );
    case 'steps':
      return (
        <ol className="my-3 flex max-w-[68ch] list-decimal flex-col gap-1.5 pl-5 text-md leading-[1.6]">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ol>
      );
    case 'callout': {
      const { icon: Icon, className } = CALLOUT[block.tone];
      return (
        <div className={cn('my-3 flex max-w-[68ch] items-start gap-2.5 rounded-md p-3', className)}>
          <Icon size={15} className="mt-0.5 shrink-0" aria-hidden />
          <p className="text-md leading-[1.6]">
            <Inline text={block.text} />
          </p>
        </div>
      );
    }
    case 'figure':
      return (
        <Figure
          chapterId={chapterId}
          name={block.name}
          alt={block.alt}
          {...(block.caption !== undefined ? { caption: block.caption } : {})}
        />
      );
    case 'table':
      return (
        <div className="my-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-md">
            <thead>
              <tr>
                {block.headers.map((h) => (
                  <th
                    key={h}
                    className="border-b border-border px-2.5 py-2 text-left font-medium text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="border-b border-border px-2.5 py-2 align-top leading-[1.5]"
                    >
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'diagram': {
      const Diagram = DIAGRAMS[block.name];
      return (
        <figure className="my-4 rounded-md border border-border bg-surface p-4">
          <Diagram />
          <figcaption className="mt-2 text-sm text-muted">{block.caption}</figcaption>
        </figure>
      );
    }
    case 'shortcuts':
      return (
        <ul className="my-3 flex max-w-[68ch] flex-col gap-1.5">
          {block.items.map((item) => (
            <li key={item.label} className="flex items-baseline justify-between gap-4 text-md">
              <span>{item.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {item.keys.split(' ').map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'related': {
      const chapters = block.ids.map((id) => chapterById.get(id)).filter((c) => c !== undefined);
      if (chapters.length === 0) return null;
      return (
        <div className="my-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-sm text-muted">See also</span>
          {chapters.map((c) => (
            <Link
              key={c.id}
              to="/help"
              search={{ chapter: c.id } as never}
              className="text-md no-underline hover:underline"
            >
              {c.title}
            </Link>
          ))}
        </div>
      );
    }
    case 'permissions': {
      const rows = permissionRows(block.roles);
      return (
        <div className="my-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-md">
            <thead>
              <tr>
                <th className="border-b border-border px-2.5 py-2 text-left font-medium text-muted">
                  Permission
                </th>
                {block.roles.map((r) => (
                  <th
                    key={r}
                    className="border-b border-border px-2.5 py-2 text-center font-medium text-muted capitalize"
                  >
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.permission}>
                  <td className="mono border-b border-border px-2.5 py-1.5 text-sm">
                    {row.permission}
                  </td>
                  {row.held.map((held, i) => (
                    <td key={i} className="border-b border-border px-2.5 py-1.5 text-center">
                      {held ? (
                        <Badge tone="success">Yes</Badge>
                      ) : (
                        <span className="text-faint">no</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
}
