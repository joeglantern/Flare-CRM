/**
 * Breadcrumb and document title, set by each screen and rendered by the top bar.
 * Keeping it in a tiny store avoids threading props through every route.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

export interface Crumb {
  label: string;
  href?: string;
}

interface PageMetaState {
  crumbs: Crumb[];
  set: (crumbs: Crumb[]) => void;
}

export const usePageMetaStore = create<PageMetaState>((set) => ({
  crumbs: [],
  set: (crumbs) => {
    set({ crumbs });
  },
}));

/** Call once per screen. The last crumb becomes the document title. */
export function usePageMeta(crumbs: Crumb[]): void {
  const key = crumbs.map((c) => `${c.label}|${c.href ?? ''}`).join('>');
  useEffect(() => {
    usePageMetaStore.getState().set(crumbs);
    const last = crumbs[crumbs.length - 1]?.label;
    document.title = last !== undefined ? `${last} · Flare CRM` : 'Flare CRM';
    // `key` is the stable identity of the crumb list; the array itself is rebuilt every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
