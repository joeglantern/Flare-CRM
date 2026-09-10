import { describe, expect, it } from 'vitest';
import { twoFactorStep } from './two-factor-step.js';

describe('where the two-factor screen sends somebody', () => {
  it('asks for a code only when there is no session yet', () => {
    expect(twoFactorStep({ session: null, setup: false })).toBe('verify');
  });

  it('sends a signed-in account with no second factor to enrolment, however it arrived', () => {
    // The reset case: their sessions were ended, they signed in again, and something put them
    // back on the code screen. There is no code to give, so this must not be 'verify'.
    expect(twoFactorStep({ session: { twoFactorEnabled: false }, setup: false })).toBe('enrol');
    expect(twoFactorStep({ session: { twoFactorEnabled: false }, setup: true })).toBe('enrol');
  });

  it('has nothing to offer an account that is already past its second factor', () => {
    expect(twoFactorStep({ session: { twoFactorEnabled: true }, setup: false })).toBe('app');
    expect(twoFactorStep({ session: { twoFactorEnabled: true }, setup: true })).toBe('app');
  });

  it('starts again when enrolment is asked for without a session', () => {
    expect(twoFactorStep({ session: null, setup: true })).toBe('sign-in');
  });
});
