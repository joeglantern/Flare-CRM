/**
 * Outbound email via SMTP (docs/02). All application email goes through `app.mailer.send`.
 * In the worker, jobs call the same API; the api process enqueues instead of sending inline
 * except for auth emails, which are time-sensitive and sent directly.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Messages captured when `capture` is enabled (tests). */
  readonly outbox: MailMessage[];
}

export function createMailer(opts: {
  smtpUrl: string;
  from: string;
  capture?: boolean;
  log: { error: (o: unknown, m: string) => void };
}): Mailer {
  const outbox: MailMessage[] = [];
  let transporter: Transporter | null = null;
  if (!opts.capture) {
    transporter = nodemailer.createTransport(opts.smtpUrl);
  }
  return {
    outbox,
    async send(message) {
      if (opts.capture || transporter === null) {
        outbox.push(message);
        return;
      }
      try {
        await transporter.sendMail({ from: opts.from, ...message });
      } catch (err) {
        opts.log.error({ err, to: message.to, subject: message.subject }, 'email send failed');
        throw err;
      }
    },
  };
}

export default fp(
  function mailerPlugin(app: FastifyInstance) {
    const mailer = createMailer({
      smtpUrl: app.config.SMTP_URL,
      from: app.config.MAIL_FROM,
      capture: app.config.NODE_ENV === 'test',
      log: app.log,
    });
    app.decorate('mailer', mailer);
  },
  { name: 'mailer', dependencies: ['config'] },
);
