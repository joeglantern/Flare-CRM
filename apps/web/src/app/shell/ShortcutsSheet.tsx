/**
 * KeyboardShortcutsSheet (Component Inventory · App shell): the ? sheet, grouped by area,
 * generated from the same registry the palette uses.
 */
import { Kbd } from '@/components/ui/Kbd';
import { Dialog } from '@/components/ui/Overlay';
import { SHORTCUT_GROUPS } from './shortcuts';

export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Sequences such as G then C are typed one key after the other."
      width={620}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-sm font-medium tracking-[0.04em] text-muted uppercase">
              {g.title}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {g.items.map((i) => (
                <li key={i.label} className="flex items-center gap-3 text-base">
                  <span className="min-w-0 flex-1 truncate">{i.label}</span>
                  <span className="flex shrink-0 gap-1">
                    {i.keys.split(' ').map((k, idx) => (
                      <Kbd key={`${k}-${String(idx)}`}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
