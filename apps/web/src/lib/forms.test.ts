import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/errors';
import { applyServerErrors } from './forms';

describe('applyServerErrors', () => {
  it('maps 422 details onto field paths, including nested and bracketed ones', () => {
    const setError = vi.fn();
    const err = new ApiError(422, 'VALIDATION_FAILED', 'Invalid', 'r', [
      { path: 'email', message: 'Already used' },
      { path: 'phones[0].number', message: 'Invalid' },
    ]);
    expect(applyServerErrors(err, setError)).toBe(true);
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'Already used' });
    expect(setError).toHaveBeenCalledWith('phones.0.number', {
      type: 'server',
      message: 'Invalid',
    });
  });

  it('puts non-field errors on root.server', () => {
    const setError = vi.fn();
    expect(
      applyServerErrors(
        new ApiError(409, 'CONFLICT', 'Duplicate contact', 'r', undefined),
        setError,
      ),
    ).toBe(false);
    expect(setError).toHaveBeenCalledWith('root.server', {
      type: 'server',
      message: 'Duplicate contact',
    });
    expect(applyServerErrors(new Error('boom'), setError)).toBe(false);
    expect(setError).toHaveBeenLastCalledWith('root.server', { type: 'server', message: 'boom' });
  });
});
