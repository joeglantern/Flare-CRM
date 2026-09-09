import { describe, expect, it } from 'vitest';
import { formatBytes } from './attachments';

describe('formatBytes', () => {
  it('stays in bytes under one kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });
  it('shows one decimal place under ten units, none at or above it', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 10)).toBe('10 KB');
  });
  it('steps up through KB, MB and GB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
  it('stops at GB rather than inventing a TB unit', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 5)).toBe('5.0 GB');
  });
});
