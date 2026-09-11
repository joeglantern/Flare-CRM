/**
 * What the console says by email: an owner's password link, an owner's two-factor reset, and an
 * alert opening or clearing. The layout is the one every installation uses; the sender is the
 * provider, so the footer names the console's hostname instead of a customer's.
 */
import {
  emailClock,
  emailDateTime,
  firstName,
  renderEmail,
  type EmailSender,
  type RenderedEmail,
} from '@crm/shared';

/** How long a password link works. Better Auth is configured from this, so the words cannot drift. */
export const RESET_LINK_SECONDS = 60 * 15;

/** Owners have no zone of their own on record here, and the business is in Nairobi. */
const ZONE = 'Africa/Nairobi';
const SIGN = 'Flare console';

export function consoleSender(consoleUrl: string, markUrl?: string | null): EmailSender {
  return {
    kind: 'console',
    name: null,
    host: new URL(consoleUrl).host,
    markUrl: markUrl ?? null,
  };
}

export function ownerPasswordEmail(input: {
  to: string;
  name: string;
  url: string;
  welcome: boolean;
  sender: EmailSender;
  now?: Date;
}): RenderedEmail {
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + RESET_LINK_SECONDS * 1000);
  const expiry = `The link below works once and expires in fifteen minutes, at ${emailClock(expires, ZONE)}.`;
  if (input.welcome) {
    return renderEmail({
      to: input.to,
      subject: 'Set your password for the Flare console',
      preheader: 'You are now an owner of the Flare console. The link works for fifteen minutes.',
      heading: `${firstName(input.name)}, you are now an owner of the Flare console.`,
      paragraphs: [
        'The console is where customer installations, their plans and every support action are managed.',
        `To start, set a password. ${expiry}`,
        'Straight afterwards you will be asked to set up an authenticator app. It is required for everybody here.',
      ],
      button: { label: 'Set your password', url: input.url },
      after: [
        'If you were not expecting this, ignore it and tell the other owners. Nothing happens until a password is set.',
      ],
      sign: SIGN,
      reason:
        'You received it because you were added as an owner of the console. There is nothing to unsubscribe from.',
      sender: input.sender,
    });
  }
  return renderEmail({
    to: input.to,
    subject: 'Reset your Flare console password',
    preheader:
      'Someone asked to reset the password on your console account. The link expires in fifteen minutes.',
    heading: 'Reset your password.',
    paragraphs: [
      `A password reset was requested for ${input.to} at ${emailClock(now, ZONE)} today.`,
      expiry,
    ],
    button: { label: 'Choose a new password', url: input.url },
    after: [
      'If you did not ask for this, ignore it and tell the other owners. Your password has not changed and nobody can change it without this message.',
    ],
    sign: SIGN,
    reason:
      'You received it because a password reset was requested for this console account. There is nothing to unsubscribe from.',
    sender: input.sender,
  });
}

export function ownerTwoFactorResetEmail(input: {
  to: string;
  /** "Samuel Kiptoo (samuel@example.com)", or a plain description when nobody is on record. */
  doneBy: string;
  contactName: string | null;
  url: string;
  sender: EmailSender;
  when?: Date;
}): RenderedEmail {
  const when = input.when ?? new Date();
  return renderEmail({
    to: input.to,
    subject: 'Your console two-factor was reset',
    preheader:
      'Another owner removed the authenticator from your console account. Here is who and when.',
    heading: 'Two-factor was reset on your console account.',
    paragraphs: [
      'The authenticator app on your Flare console account has been removed, and your old backup codes no longer work. You will be asked to set up a new one the next time you sign in to the console.',
      'This was done by another owner. The details are below, exactly as recorded.',
    ],
    facts: [
      { label: 'Done by', value: input.doneBy },
      { label: 'When', value: emailDateTime(when, ZONE) },
      { label: 'Your account', value: input.to },
    ],
    button: { label: 'Sign in and set up again', url: input.url },
    after: [
      `If you did not lose access to your authenticator, or you do not recognise the person above, do not sign in from this message. Speak to ${input.contactName ?? 'the other owners'} directly, and check the console audit log from a session you already trust.`,
      'This message is sent to the account owner whenever two-factor is reset, and cannot be turned off.',
    ],
    sign: SIGN,
    reason:
      'You received it because a security setting on your own console account changed. It is sent to you and to nobody else.',
    sender: input.sender,
  });
}

interface AlertAbout {
  to: string;
  customerName: string;
  customerHost: string | null;
  label: string;
  url: string;
  sender: EmailSender;
}

function customerLine(about: AlertAbout): string {
  return about.customerHost === null
    ? about.customerName
    : `${about.customerName}, ${about.customerHost}`;
}

const ALERT_REASON =
  'You received it because this address is the provider contact set in the console, and alerts go to that address. There is nothing to unsubscribe from.';

export function alertOpenedEmail(
  input: AlertAbout & {
    description: string;
    summary: string;
    danger: boolean;
    since: Date;
  },
): RenderedEmail {
  return renderEmail({
    to: input.to,
    subject: `${input.danger ? 'Attention' : 'Notice'}: ${input.customerName}, ${input.label}`,
    preheader: `${input.label} at ${input.customerName}. ${input.summary}`,
    heading: input.danger
      ? `Something is wrong at ${input.customerName}.`
      : `${input.label} at ${input.customerName}.`,
    paragraphs: [input.description],
    facts: [
      { label: 'Customer', value: customerLine(input) },
      { label: 'Alert', value: input.label },
      { label: 'Detail', value: input.summary },
      { label: 'Since', value: emailDateTime(input.since, ZONE) },
    ],
    button: { label: 'Open in the console', url: input.url },
    after: ['You will get one more message when it clears, and nothing in between.'],
    sign: SIGN,
    reason: ALERT_REASON,
    sender: input.sender,
  });
}

export function alertClearedEmail(
  input: AlertAbout & { openedAt: Date; clearedAt: Date },
): RenderedEmail {
  return renderEmail({
    to: input.to,
    subject: `Cleared: ${input.customerName}, ${input.label}`,
    preheader: `The console no longer sees this at ${input.customerName} and has closed the alert.`,
    heading: `${input.label} at ${input.customerName} has cleared.`,
    paragraphs: [
      'The console no longer sees what it wrote to you about, and has closed the alert. Nothing more is needed unless it opens again.',
    ],
    facts: [
      { label: 'Customer', value: customerLine(input) },
      { label: 'Alert', value: input.label },
      { label: 'Opened', value: emailDateTime(input.openedAt, ZONE) },
      { label: 'Cleared', value: emailDateTime(input.clearedAt, ZONE) },
    ],
    button: { label: 'Open in the console', url: input.url },
    sign: SIGN,
    reason: ALERT_REASON,
    sender: input.sender,
  });
}
