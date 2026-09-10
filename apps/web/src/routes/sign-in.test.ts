import { describe, expect, it } from 'vitest';
import { safeRedirect } from './sign-in';

describe('where a sign-in sends somebody afterwards', () => {
  it('honours a same-origin path', () => {
    expect(safeRedirect('/contacts/123')).toBe('/contacts/123');
    expect(safeRedirect('/reports?range=30')).toBe('/reports?range=30');
  });

  it('refuses anything that leaves this origin', () => {
    expect(safeRedirect('https://evil.example.com')).toBe('/home');
    expect(safeRedirect('//evil.example.com')).toBe('/home');
    expect(safeRedirect(undefined)).toBe('/home');
  });

  it('never sends anybody back to an auth screen', () => {
    // Somebody whose second factor was just reset would otherwise be dropped on the code box,
    // where no code they can produce will ever work.
    expect(safeRedirect('/two-factor')).toBe('/home');
    expect(safeRedirect('/two-factor?redirect=/home')).toBe('/home');
    expect(safeRedirect('/sign-in')).toBe('/home');
    expect(safeRedirect('/reset-password?token=abc')).toBe('/home');
    expect(safeRedirect('/forgot-password')).toBe('/home');
    // A page that merely starts with the same letters is a different page.
    expect(safeRedirect('/two-factor-report')).toBe('/two-factor-report');
  });
});
