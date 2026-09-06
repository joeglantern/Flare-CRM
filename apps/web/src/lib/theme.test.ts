import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, initTheme, useTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to dark and writes data-theme on <html>', () => {
    initTheme();
    expect(useTheme.getState().resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists the preference and toggles', () => {
    initTheme();
    useTheme.getState().toggle();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('flare.theme')).toBe('light');
    initTheme(); // a reload keeps the choice
    expect(useTheme.getState().resolved).toBe('light');
  });

  it('applyTheme resolves system to a concrete theme', () => {
    expect(['dark', 'light']).toContain(applyTheme('system'));
  });
});
