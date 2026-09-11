import { describe, expect, it } from 'vitest';
import { hasPermission } from './permissions';

const support = ['customer:read', 'support:run', 'analytics:read', 'stack:operate'];

describe('hasPermission', () => {
  it('holds a permission it was given', () => {
    expect(hasPermission(support, 'support:run')).toBe(true);
  });

  it('does not hold one it was not', () => {
    expect(hasPermission(support, 'plan:write')).toBe(false);
  });

  it('needs every permission when several are asked for', () => {
    expect(hasPermission(support, ['customer:read', 'analytics:read'])).toBe(true);
    expect(hasPermission(support, ['customer:read', 'customer:write'])).toBe(false);
  });

  it('grants nothing before the account is known, rather than flashing a control', () => {
    expect(hasPermission(undefined, 'customer:read')).toBe(false);
  });
});
