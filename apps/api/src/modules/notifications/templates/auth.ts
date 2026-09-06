/**
 * Auth email templates. Plain functions producing text + HTML; all interpolated values are escaped.
 */
import type { MailMessage } from '../../../plugins/mailer.js';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f6f7f9;padding:24px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:8px;padding:32px;color:#111">
<tr><td><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}
<p style="color:#666;font-size:12px;margin-top:32px">If you did not expect this email you can ignore it.</p></td></tr></table></td></tr></table></body></html>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#666">Or copy this link: ${escapeHtml(url)}</p>`;
}

export function welcomeSetPassword(input: {
  to: string;
  name: string;
  url: string;
  appName: string;
}): MailMessage {
  const title = `Welcome to ${input.appName}`;
  return {
    to: input.to,
    subject: title,
    text: `Hi ${input.name},\n\nAn account has been created for you. Set your password here (link valid for a limited time):\n${input.url}\n`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(input.name)},</p><p>An account has been created for you. Set your password to get started.</p>${button(input.url, 'Set password')}`,
    ),
  };
}

export function passwordReset(input: {
  to: string;
  name: string;
  url: string;
  appName: string;
}): MailMessage {
  const title = `Reset your ${input.appName} password`;
  return {
    to: input.to,
    subject: title,
    text: `Hi ${input.name},\n\nUse this link to reset your password (valid for 15 minutes):\n${input.url}\n`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(input.name)},</p><p>Use the button below to choose a new password. The link expires in 15 minutes.</p>${button(input.url, 'Reset password')}`,
    ),
  };
}

export function verifyEmail(input: {
  to: string;
  name: string;
  url: string;
  appName: string;
}): MailMessage {
  const title = `Verify your email for ${input.appName}`;
  return {
    to: input.to,
    subject: title,
    text: `Hi ${input.name},\n\nPlease verify your email address:\n${input.url}\n`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(input.name)},</p><p>Please confirm this is your email address.</p>${button(input.url, 'Verify email')}`,
    ),
  };
}
