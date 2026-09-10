/**
 * Where somebody standing in front of the two-factor screen actually belongs.
 *
 * Both front ends have the same two screens behind one route, and both have to answer the same
 * question: is this person half way through signing in and owed a code box, or are they signed in
 * and owed an authenticator to set up? Getting it wrong is not cosmetic. A person whose second
 * factor has just been reset, arriving on the code screen from a stale tab, a bookmark or a back
 * button, can never leave it: the secret their code would have to match was deleted, so every code
 * they will ever type is wrong and the screen offers no way forward.
 *
 * The deciding fact is the session, not the URL. Better Auth issues no session until the second
 * factor is verified, so no session means the code box is right. A session means it never is.
 */

/** The state of whoever is asking, as the browser can see it. */
export interface TwoFactorViewer {
  /** A full session, not the half-authenticated state between password and code. */
  session: { twoFactorEnabled: boolean } | null;
  /** Whether the screen was asked for in its enrolment shape. */
  setup: boolean;
}

export type TwoFactorStep =
  /** Ask for a code: this person is between their password and their second factor. */
  | 'verify'
  /** Offer an authenticator to set up: signed in, with no second factor on the account. */
  | 'enrol'
  /** Nothing to do here: signed in and already past the second factor. */
  | 'app'
  /** Enrolling needs a session and there is none: start again. */
  | 'sign-in';

export function twoFactorStep({ session, setup }: TwoFactorViewer): TwoFactorStep {
  // With a session, the account's own state decides and the URL is ignored: asking for the
  // enrolment screen when there is nothing to enrol is as wrong as asking for a code box.
  if (session !== null) return session.twoFactorEnabled ? 'app' : 'enrol';
  return setup ? 'sign-in' : 'verify';
}
