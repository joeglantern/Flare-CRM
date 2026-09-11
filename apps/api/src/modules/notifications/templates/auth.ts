/**
 * What a customer's own installation says by email: the welcome, a reset, an address check, a
 * two-factor reset, and the notice that the provider acted here.
 *
 * The layout, the escaping and the plain text version all live in `renderEmail`; this file is only
 * the words. Expiry goes in the body as a fact with a time, never in small print, and every message
 * says who sent it in a way a forgery cannot copy: the installation's own hostname.
 */
import {
  emailClock,
  emailDateTime,
  firstName,
  renderEmail,
  type EmailFact,
  type EmailSender,
} from '@crm/shared';
import type { MailMessage } from '../../../plugins/mailer.js';
import type { Db } from '../../../plugins/prisma.js';

/** How long a password link works. Better Auth is configured from this, so the words cannot drift. */
export const RESET_LINK_SECONDS = 60 * 15;
/** How long an address confirmation link works, configured the same way. */
export const VERIFY_LINK_SECONDS = 60 * 60;

export interface Installation {
  appUrl: string;
  sender: EmailSender;
}

/**
 * Who this installation is, for the letterhead and footer. The name comes from the signed document
 * the console issued; an unmanaged installation has none and says so rather than inventing one.
 */
export async function readInstallation(db: Db, appUrl: string): Promise<Installation> {
  const base = appUrl.replace(/\/+$/, '');
  let name: string | null = null;
  try {
    const row = await db.entitlement.findUnique({
      where: { id: 'current' },
      select: { payload: true },
    });
    const payload = row?.payload as { customerName?: unknown } | null | undefined;
    if (typeof payload?.customerName === 'string' && payload.customerName.trim() !== '') {
      name = payload.customerName.trim();
    }
  } catch {
    // A name we cannot read is not a reason to hold back a password link.
  }
  return {
    appUrl: base,
    sender: {
      kind: 'installation',
      name,
      host: new URL(base).host,
      markUrl: `${base}/brand/mark-email.png`,
    },
  };
}

export function welcomeSetPassword(input: {
  to: string;
  name: string;
  url: string;
  installation: Installation;
  /** "Grace Akinyi (grace@example.com)", or null when nobody is on record as asking. */
  invitedBy: string | null;
  timeZone?: string | null;
  now?: Date;
}): MailMessage {
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + RESET_LINK_SECONDS * 1000);
  const place = input.installation.sender.name;
  const who = input.invitedBy ?? 'An administrator';
  return renderEmail({
    to: input.to,
    subject: 'Set your password for Flare',
    preheader: `${who} added you to ${place ?? 'Flare'}. The link works for fifteen minutes.`,
    heading: `${firstName(input.name)}, you have been added to ${place ?? 'Flare'}.`,
    paragraphs: [
      `${who} has added you as a user of Flare, the system ${place ?? 'your organisation'} uses for calls, WhatsApp and customers.`,
      `To start, set a password. The link below works once and expires in fifteen minutes, at ${emailClock(expires, input.timeZone)}.`,
    ],
    button: { label: 'Set your password', url: input.url },
    after: [
      `If the link has run out, open ${input.installation.appUrl}/forgot-password and enter this address to get a new one.`,
      'If you were not expecting this, you can ignore it. Nothing happens until a password is set.',
    ],
    sign: place ?? 'Flare CRM',
    reason: `You received it because an administrator${place === null ? '' : ` at ${place}`} added you as a user. It is not a newsletter and there is nothing to unsubscribe from.`,
    sender: input.installation.sender,
  });
}

export function passwordReset(input: {
  to: string;
  url: string;
  installation: Installation;
  timeZone?: string | null;
  now?: Date;
}): MailMessage {
  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + RESET_LINK_SECONDS * 1000);
  return renderEmail({
    to: input.to,
    subject: 'Reset your Flare password',
    preheader:
      'Someone asked to reset the password for this address. The link expires in fifteen minutes.',
    heading: 'Reset your password.',
    paragraphs: [
      `A password reset was requested for ${input.to} at ${emailClock(now, input.timeZone)} today.`,
      `The link below works once and expires in fifteen minutes, at ${emailClock(expires, input.timeZone)}.`,
    ],
    button: { label: 'Choose a new password', url: input.url },
    after: [
      'If you did not ask for this, ignore it. Your password has not changed and nobody can change it without this message.',
    ],
    sign: input.installation.sender.name ?? 'Flare CRM',
    reason:
      'You received it because a password reset was requested for this address. There is nothing to unsubscribe from.',
    sender: input.installation.sender,
  });
}

export function verifyEmail(input: {
  to: string;
  url: string;
  installation: Installation;
}): MailMessage {
  const place = input.installation.sender.name;
  return renderEmail({
    to: input.to,
    subject: 'Confirm your email address for Flare',
    preheader: 'This address was entered on a Flare account. Confirm it to finish.',
    heading: 'Confirm this address.',
    paragraphs: [
      `This address was entered on a Flare account${place === null ? '' : ` at ${place}`}.`,
      'Confirm it with the link below. The link expires in one hour.',
    ],
    button: { label: 'Confirm this address', url: input.url },
    after: ['If this was not you, do nothing and tell your administrator.'],
    sign: place ?? 'Flare CRM',
    reason:
      'You received it because this address was entered on a Flare account. There is nothing to unsubscribe from.',
    sender: input.installation.sender,
  });
}

/**
 * Sent to the person whose second factor was cleared, not to whoever cleared it.
 *
 * Without this the first they hear of it is a code that stops working, and the natural reading of
 * that is "my account is broken" rather than "I need to set up my authenticator again". It also
 * means an unexpected reset reaches the person it happened to, which is the only way they would
 * ever know to ask about it. No urgency devices: who, when, why, and what to do.
 */
export function twoFactorReset(input: {
  to: string;
  url: string;
  installation: Installation;
  /** In words the reader will recognise: a name and an address, or "Flare support, …". */
  doneBy: string;
  /** Somebody to speak to if it was unexpected. Null when the reset came from support. */
  contactName: string | null;
  byProvider: boolean;
  reason?: string | null;
  when?: Date;
  timeZone?: string | null;
}): MailMessage {
  const when = input.when ?? new Date();
  const place = input.installation.sender.name;
  const reason = input.reason?.trim() ?? '';
  const facts: EmailFact[] = [
    { label: 'Done by', value: input.doneBy },
    { label: 'When', value: emailDateTime(when, input.timeZone) },
    ...(reason === '' ? [] : [{ label: 'Reason given', value: reason }]),
    { label: 'Your account', value: input.to },
  ];
  const speakTo = input.byProvider
    ? `speak to an administrator${place === null ? '' : ` at ${place}`} directly, by phone or in person, and ask them to check the audit log.`
    : `contact ${input.contactName ?? 'an administrator'}${input.contactName === null ? '' : ' or another administrator'} directly, by phone or in person, and ask them to check the audit log.`;
  return renderEmail({
    to: input.to,
    subject: 'Your two-factor sign-in was reset',
    preheader: `${input.byProvider ? 'Flare support' : 'An administrator'} removed the authenticator from your account. Here is who, when and why.`,
    heading: 'Two-factor was reset on your account.',
    paragraphs: [
      `The authenticator app on your Flare account${place === null ? '' : ` at ${place}`} has been removed, and your old backup codes no longer work. You will be asked to set up a new authenticator the next time you sign in.`,
      input.byProvider
        ? 'This was done by Flare support, the provider of this installation, at a request from your organisation. The details are below, exactly as recorded in the audit log.'
        : 'This was done by an administrator. The details are below, exactly as recorded in the audit log.',
    ],
    facts,
    button: { label: 'Sign in and set up again', url: input.url },
    after: [
      `If you did not lose access to your authenticator, or you do not recognise the person above, do not sign in from this message. Instead, ${speakTo}`,
      'This message is sent to the account owner whenever two-factor is reset, and cannot be turned off.',
    ],
    sign: place ?? 'Flare CRM',
    reason:
      'You received it because a security setting on your own account changed. It is sent to you and to nobody else.',
    sender: input.installation.sender,
  });
}

/**
 * Sent to every administrator whenever the provider uses a support action here, so nothing done
 * from outside is invisible to the people who run the installation.
 */
export function supportNotice(input: {
  to: string;
  installation: Installation;
  action: string;
  affected: string;
  provider: string;
  reason: string | null;
  when?: Date;
  timeZone?: string | null;
}): MailMessage {
  const when = input.when ?? new Date();
  const place = input.installation.sender.name;
  const reason = input.reason?.trim() ?? '';
  return renderEmail({
    to: input.to,
    subject: 'Flare support acted in your installation',
    preheader:
      'We used a support action in your installation today. It is written to your audit log.',
    heading: 'We did something in your installation.',
    paragraphs: [
      `At a request from ${place ?? 'your organisation'}, Flare support carried out an action in this installation. This message tells you what it was, so nothing we do is invisible to you.`,
    ],
    facts: [
      { label: 'Action', value: input.action },
      { label: 'Affected', value: input.affected },
      { label: 'Done by', value: `Flare support, ${input.provider}` },
      { label: 'When', value: emailDateTime(when, input.timeZone) },
      ...(reason === '' ? [] : [{ label: 'Reason given', value: reason }]),
    ],
    button: {
      label: 'Open your audit log',
      url: `${input.installation.appUrl}/settings?section=audit`,
    },
    after: [
      'Every support action is written to your own audit log with Flare support named as the actor, and this message goes to every administrator of the installation. If nobody here asked for it, tell us straight away.',
    ],
    sign: 'Flare support',
    reason:
      'You received it because you are an administrator of this installation. Every administrator receives a copy and it cannot be turned off.',
    sender: input.installation.sender,
  });
}
