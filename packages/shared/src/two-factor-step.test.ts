import { describe, expect, it } from 'vitest';
import { twoFactorStep } from './two-factor-step.js';

describe('where the two-factor screen sends somebody', () => {
  it('asks for a code between a password and its second factor', () => {
    // No session yet, because Better Auth issues none until the code is verified.
    expect(
      twoFactorStep({ api: { kind: 'unauthenticated' }, hasClientSession: false, setup: false }),
    ).toBe('verify');
  });

  it('offers enrolment to a session with no second factor, whatever the URL asked for', () => {
    for (const setup of [false, true]) {
      expect(
        twoFactorStep({
          api: { kind: 'ok', twoFactorEnabled: false },
          hasClientSession: true,
          setup,
        }),
      ).toBe('enrol');
    }
  });

  it('offers enrolment when the API refuses everything until a factor exists', () => {
    expect(
      twoFactorStep({ api: { kind: 'two-factor-required' }, hasClientSession: true, setup: false }),
    ).toBe('enrol');
  });

  it('lets somebody past only once the API itself says the factor is there', () => {
    for (const setup of [false, true]) {
      expect(
        twoFactorStep({
          api: { kind: 'ok', twoFactorEnabled: true },
          hasClientSession: true,
          setup,
        }),
      ).toBe('app');
    }
  });

  it('sends somebody back to sign in when enrolling without a session', () => {
    expect(
      twoFactorStep({ api: { kind: 'unauthenticated' }, hasClientSession: false, setup: true }),
    ).toBe('sign-in');
  });

  /**
   * The loop this function exists to prevent. The browser holds a session claiming the second
   * factor is enrolled while the API disagrees; if that claim were allowed to mean "go to the
   * application", the layout there would bounce the person straight back here.
   */
  it('never sends somebody into the application on the browser session alone', () => {
    expect(
      twoFactorStep({ api: { kind: 'unauthenticated' }, hasClientSession: true, setup: false }),
    ).toBe('verify');
    expect(
      twoFactorStep({ api: { kind: 'unauthenticated' }, hasClientSession: true, setup: true }),
    ).toBe('verify');
    expect(
      twoFactorStep({ api: { kind: 'two-factor-required' }, hasClientSession: true, setup: true }),
    ).toBe('enrol');
  });
});
