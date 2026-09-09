/**
 * The one keyboard registry: the command palette and the ? sheet are both generated from it
 * (Component Inventory · KeyboardShortcutsSheet). Groups and keys match the App Shell design.
 */
import type { Permission } from '@crm/shared';

export interface ShortcutDef {
  label: string;
  keys: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutDef[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      { label: 'Command palette', keys: 'Ctrl K' },
      { label: 'Search', keys: '/' },
      { label: 'Toggle sidebar', keys: 'Ctrl B' },
      { label: 'Shortcuts sheet', keys: '?' },
      { label: 'Close / cancel', keys: 'Esc' },
    ],
  },
  {
    title: 'Calls',
    items: [
      { label: 'Answer ringing call', keys: 'Enter' },
      { label: 'Decline', keys: 'Esc' },
      { label: 'Hold / resume', keys: 'H' },
      { label: 'Mute / unmute', keys: 'M' },
      { label: 'Save disposition', keys: 'Enter' },
    ],
  },
  {
    title: 'Go to',
    items: [
      { label: 'Home', keys: 'G H' },
      { label: 'Contacts', keys: 'G C' },
      { label: 'Inbox', keys: 'G I' },
      { label: 'Tasks', keys: 'G T' },
      { label: 'Missed calls', keys: 'G M' },
      { label: 'The manual', keys: 'G L' },
    ],
  },
  {
    title: 'Create',
    items: [
      { label: 'New contact', keys: 'C' },
      { label: 'New task', keys: 'T' },
      { label: 'New note on record', keys: 'N' },
      { label: 'New deal', keys: 'D' },
      { label: 'Select row / toggle', keys: 'X' },
    ],
  },
];

/** "G then C" style sequences, resolved to a route. */
export const GOTO_SEQUENCES: { key: string; to: string; permission?: Permission }[] = [
  { key: 'h', to: '/home' },
  { key: 'c', to: '/contacts', permission: 'contact:read' },
  { key: 'i', to: '/inbox', permission: 'chat:read' },
  { key: 't', to: '/tasks', permission: 'task:read' },
  { key: 'm', to: '/calls/missed', permission: 'call:read' },
  { key: 'l', to: '/help' },
];

/** True when a keystroke should be ignored because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
