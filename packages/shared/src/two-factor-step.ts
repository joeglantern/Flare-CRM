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
 * The deciding fact is what the API says, and only what the API says. This used to read the
 * browser's own session, which is a second opinion, and two opinions is how a redirect loop is
 * built: the authenticated layout asks the API, is told the second factor is missing, and sends the
 * person here; this screen read a cached session that said the factor was present, decided there
 * was nothing to do, and sent them back. Round and round until the router gave up. The API rereads
 * the flag from the database on every request precisely because enrolment changes it mid-session,
 * so it is the half that is never stale.
 *
 * The browser's session is still consulted for the one thing the API cannot express: between a
 * password and its code there is no session at all, so an unauthenticated answer alone cannot tell
 * somebody mid-sign-in from somebody signed out.
 */

/** What the API answered for this person, from the same endpoint that guards every other route. */
export type TwoFactorVerdict =
  /** It answered. `twoFactorEnabled` is the fresh database value, not a cached one. */
  | { kind: 'ok'; twoFactorEnabled: boolean }
  /** No session: either between a password and its code, or signed out altogether. */
  | { kind: 'unauthenticated' }
  /** A session, but this role may do nothing else until a second factor exists. */
  | { kind: 'two-factor-required' };

/** The state of whoever is asking. */
export interface TwoFactorViewer {
  api: TwoFactorVerdict;
  /**
   * Whether the browser still holds a session of its own. Only used to read an unauthenticated
   * answer, and deliberately never used to decide that somebody may enter the application.
   */
  hasClientSession: boolean;
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

export function twoFactorStep({ api, hasClientSession, setup }: TwoFactorViewer): TwoFactorStep {
  // Only the API can send somebody into the application, because the API is what will let them do
  // anything once they are there. Any other source of that decision can disagree with the guard on
  // the other side of the redirect, and a disagreement between two guards is a loop.
  if (api.kind === 'ok') return api.twoFactorEnabled ? 'app' : 'enrol';
  if (api.kind === 'two-factor-required') return 'enrol';

  // The API has no session for this person. Better Auth issues none until a second factor is
  // verified, so a browser that still holds one is either mid-sign-in or holding something stale.
  // Both are answered by the code box: it is the only screen that can carry either state forward,
  // and it offers a way out for a session that turns out to be worthless.
  if (hasClientSession) return 'verify';
  return setup ? 'sign-in' : 'verify';
}
