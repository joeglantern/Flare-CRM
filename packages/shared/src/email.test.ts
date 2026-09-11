import { describe, expect, it } from 'vitest';
import { emailClock, emailDateTime, firstName, renderEmail, type EmailContent } from './email.js';

const message: EmailContent = {
  to: 'wanjiru@example.com',
  subject: 'Your two-factor sign-in was reset',
  preheader: 'An administrator removed the authenticator from your account.',
  heading: 'Two-factor was reset on your account.',
  paragraphs: ['Your old backup codes no longer work.'],
  facts: [
    { label: 'Done by', value: 'Grace Akinyi (grace@example.com)' },
    { label: 'Reason given', value: 'Phone lost on Friday' },
  ],
  button: { label: 'Sign in and set up again', url: 'https://crm.example.com/sign-in' },
  after: ['This message cannot be turned off.'],
  sign: 'Kilimani Auto Parts',
  reason: 'You received it because a security setting on your own account changed.',
  sender: {
    kind: 'installation',
    name: 'Kilimani Auto Parts',
    host: 'crm.example.com',
    markUrl: 'https://crm.example.com/brand/mark-email.png',
  },
};

describe('renderEmail', () => {
  it('escapes everything a caller passes in', () => {
    const { html } = renderEmail({ ...message, heading: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps the facts, the address behind the button and the footer in the plain text', () => {
    const { text } = renderEmail(message);
    expect(text).toContain('Done by: Grace Akinyi (grace@example.com)');
    expect(text).toContain('https://crm.example.com/sign-in');
    expect(text).toContain('Sent by Kilimani Auto Parts from its own Flare installation');
    expect(text).toContain('Flare CRM, Nairobi.');
  });

  it('still says who sent it with no picture at all', () => {
    const { html } = renderEmail({ ...message, sender: { ...message.sender, markUrl: null } });
    expect(html).not.toContain('<img');
    expect(html).toContain('>Flare</td>');
    expect(html).toContain('crm.example.com');
  });

  it('names an installation with no customer name by its hostname alone', () => {
    const { text } = renderEmail({ ...message, sender: { ...message.sender, name: null } });
    expect(text).toContain('Sent from the Flare installation at crm.example.com.');
  });

  it('gives Outlook a button it can draw and hides the preheader', () => {
    const { html } = renderEmail(message);
    expect(html).toContain('<!--[if mso]><v:rect');
    expect(html).toContain('mso-hide:all');
    expect(html).toContain('name="color-scheme" content="light dark"');
  });

  it('never writes an em dash', () => {
    const { html, text } = renderEmail(message);
    expect(html + text).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('email times', () => {
  const at = new Date(Date.UTC(2026, 8, 10, 18, 14));

  it('writes a moment out in the reader’s zone with the zone named', () => {
    expect(emailDateTime(at, 'Africa/Nairobi')).toBe('Thursday 10 September 2026, 21:14 EAT');
    expect(emailClock(at, 'Africa/Nairobi')).toBe('21:14 EAT');
  });

  it('uses Nairobi when the zone on record is not one the runtime knows', () => {
    expect(emailClock(at, 'Not/A_Zone')).toBe('21:14 EAT');
    expect(emailClock(at, null)).toBe('21:14 EAT');
  });

  it('greets somebody by the first word of their name', () => {
    expect(firstName('  Wanjiru Kamau ')).toBe('Wanjiru');
  });
});
