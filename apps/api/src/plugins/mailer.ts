/**
 * Outbound email via SMTP (docs/02). All application email goes through `app.mailer.send`.
 * In the worker, jobs call the same API; the api process enqueues instead of sending inline
 * except for auth emails, which are time-sensitive and sent directly.
 *
 * The mail server is whatever an admin saved in Settings, else the server's SMTP_URL. A save is
 * announced on Valkey, and both processes drop their connection so the next email uses the new
 * server: no restart, and nothing queued is lost.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  INTEGRATIONS_CHANNEL,
  readSmtp,
  type SmtpTransportOptions,
} from '../modules/integrations/config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Forget the open connection, so the next send reads the settings again. */
  reset(): void;
  /** Messages captured when `capture` is enabled (tests). */
  readonly outbox: MailMessage[];
}

export function createMailer(opts: {
  resolve: () => Promise<{ transport: string | SmtpTransportOptions; from: string }>;
  capture?: boolean;
  log: { error: (o: unknown, m: string) => void };
}): Mailer {
  const outbox: MailMessage[] = [];
  let current: Promise<{ transporter: Transporter; from: string }> | null = null;
  const open = () => {
    current ??= opts.resolve().then(({ transport, from }) => ({
      transporter:
        typeof transport === 'string'
          ? nodemailer.createTransport(transport)
          : nodemailer.createTransport(transport),
      from,
    }));
    // A failed read is retried on the next send rather than remembered.
    current.catch(() => {
      current = null;
    });
    return current;
  };
  return {
    outbox,
    reset() {
      const old = current;
      current = null;
      void old?.then(({ transporter }) => {
        transporter.close();
      });
    },
    async send(message) {
      if (opts.capture) {
        outbox.push(message);
        return;
      }
      const { transporter, from } = await open();
      try {
        await transporter.sendMail({ from, ...message });
      } catch (err) {
        opts.log.error({ err, to: message.to, subject: message.subject }, 'email send failed');
        throw err;
      }
    },
  };
}

export default fp(
  async function mailerPlugin(app: FastifyInstance) {
    const mailer = createMailer({
      resolve: () => readSmtp(app.db, app.config),
      capture: app.config.NODE_ENV === 'test',
      log: app.log,
    });
    app.decorate('mailer', mailer);

    const listener = app.valkey.duplicate();
    listener.on('error', (err: unknown) => {
      app.log.warn({ err }, 'mail settings listener connection error');
    });
    await listener.subscribe(INTEGRATIONS_CHANNEL);
    listener.on('message', (_channel, key) => {
      if (key === 'smtp') mailer.reset();
    });
    app.addHook('onClose', async () => {
      mailer.reset();
      await listener.quit().catch(() => undefined);
    });
  },
  { name: 'mailer', dependencies: ['config', 'valkey', 'prisma'] },
);
