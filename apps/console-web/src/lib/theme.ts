/**
 * Theme: dark by default, light on request, or follow the OS. Applied as `data-theme` on <html>
 * (docs/18). Stored per browser, which is what localStorage is for; nothing sensitive is kept.
 */
import { create } from 'zustand';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'flare.console.theme';

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'system' || v === 'dark' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
}

export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  preference: 'dark',
  resolved: 'dark',
  setPreference: (preference) => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // storage unavailable (private mode): the choice lasts for this session only
    }
    set({ preference, resolved: applyTheme(preference) });
  },
  toggle: () => {
    get().setPreference(get().resolved === 'dark' ? 'light' : 'dark');
  },
}));

/** Call once at boot, before the first render, so there is no flash of the wrong theme. */
export function initTheme(): void {
  const preference = readStored();
  useTheme.setState({ preference, resolved: applyTheme(preference) });
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (useTheme.getState().preference === 'system') {
        useTheme.setState({ resolved: applyTheme('system') });
      }
    });
  }
}
