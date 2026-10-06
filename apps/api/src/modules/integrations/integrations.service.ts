/**
 * An admin enters or changes the email server and the PBX connection in Settings.
 *
 * Nothing is saved until it has been tried: the mail server must accept a connection (and the
 * login, when there is one), and the PBX must hand out an API token for the client ID and secret.
 * That token is given straight back with del_token, because the PBX caps how many can be live.
 *
 * Passwords and secrets are encrypted at rest, never logged, never returned and kept out of the
 * audit row; on an existing setup a blank one keeps the one in use. Dropping a saved setup goes
 * back to the server's .env.
 */
import {
  type PbxConfigBody,
  type PbxStatusDto,
  type SmtpConfigBody,
  type SmtpStatusDto,
} from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import nodemailer from 'nodemailer';
import { isOnThisMachine } from '../../config/env.js';
import { tokenResponse, YeastarClient } from '../../integrations/yeastar/client.js';
import { readCtiStatus } from '../../integrations/yeastar/subscriber.js';
import { ServiceUnavailableError, ValidationError } from '../../lib/errors.js';
import type { AuditContext } from '../audit/audit.service.js';
import {
  INTEGRATIONS_CHANNEL,
  readPbx,
  readSmtp,
  smtpTransportOf,
  writeIntegration,
  type IntegrationKey,
  type StoredPbx,
  type StoredSmtp,
} from './config.js';

const blank = (v: string | undefined) => v === undefined || v.trim() === '';

/** The reason a connection failed, in words, from the error nodemailer or undici raised. */
function reasonOf(err: unknown): string {
  const e = err as {
    code?: string;
    responseCode?: number;
    cause?: { code?: string; message?: string };
  };
  const code = e.code ?? e.cause?.code;
  if (e.responseCode === 535 || code === 'EAUTH') return 'it refused the username or password';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'that address could not be found';
  if (code === 'ECONNREFUSED') return 'nothing answered on that port';
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'UND_ERR_CONNECT_TIMEOUT')
    return 'it did not answer in time';
  const message = e.cause?.message ?? (err instanceof Error ? err.message : '');
  if (/fingerprint mismatch/i.test(message))
    return 'its certificate does not match the fingerprint';
  if (/certificate|self.signed|CERT_/i.test(message) || (code ?? '').includes('CERT'))
    return 'its certificate is not trusted; choose the fingerprint option for a self-signed PBX';
  if (/wrong version number|EPROTO/i.test(message) || code === 'EPROTO')
    return 'the encryption setting does not match that port';
  return 'the connection failed';
}

export class IntegrationsService {
  constructor(private readonly app: FastifyInstance) {}

  // ── email ──────────────────────────────────────────────────────────────────────────────

  async smtpStatus(): Promise<SmtpStatusDto> {
    const s = await readSmtp(this.app.db, this.app.config);
    if (s.stored) {
      return {
        source: 'admin',
        host: s.stored.host,
        port: s.stored.port,
        security: s.stored.security,
        username: s.stored.username,
        passwordSet: s.stored.password !== null && s.stored.password !== '',
        from: s.stored.from,
        updatedAt: s.updatedAt?.toISOString() ?? null,
      };
    }
    // The .env holds one URL with the password inside it: say where it points, never the rest.
    let host: string | null = null;
    let port: number | null = null;
    let username: string | null = null;
    let passwordSet = false;
    let security: SmtpStatusDto['security'] = null;
    try {
      const u = new URL(this.app.config.SMTP_URL);
      host = u.hostname;
      port = u.port === '' ? (u.protocol === 'smtps:' ? 465 : 587) : Number(u.port);
      username = u.username === '' ? null : decodeURIComponent(u.username);
      passwordSet = u.password !== '';
      security = u.protocol === 'smtps:' ? 'tls' : 'starttls';
    } catch {
      // not a URL nodemailer would take either; shown as unknown
    }
    return {
      source: 'server',
      host,
      port,
      security,
      username,
      passwordSet,
      from: this.app.config.MAIL_FROM,
      updatedAt: null,
    };
  }

  async saveSmtp(actorId: string, body: SmtpConfigBody, ctx: AuditContext): Promise<SmtpStatusDto> {
    const current = await readSmtp(this.app.db, this.app.config);
    const kept = current.stored;
    const sameLogin =
      kept !== null && kept.host === body.host && kept.username === (body.username ?? null);
    const username = blank(body.username) ? null : (body.username ?? null);
    const password = !blank(body.password)
      ? (body.password ?? null)
      : sameLogin
        ? kept.password
        : null;
    if (username !== null && password === null) {
      throw new ValidationError([
        { path: 'password', message: 'Enter the password for this login' },
      ]);
    }
    const stored: StoredSmtp = {
      host: body.host,
      port: body.port,
      security: body.security,
      username,
      password,
      from: body.from,
    };

    const transporter = nodemailer.createTransport(smtpTransportOf(stored));
    try {
      await transporter.verify();
    } catch (err) {
      const why = reasonOf(err);
      if (why.startsWith('it refused the username'))
        throw new ValidationError([{ path: 'password', message: `The mail server ${why}` }]);
      throw new ServiceUnavailableError(`Could not reach the mail server at ${body.host}: ${why}`);
    } finally {
      transporter.close();
    }

    await writeIntegration(this.app.db, 'smtp', stored, this.app.config.SECRETS_KEY, actorId);
    await this.app.audit.write(ctx, {
      action: 'integration.smtp_configured',
      entity: 'system',
      after: {
        host: stored.host,
        port: stored.port,
        security: stored.security,
        username: stored.username,
        from: stored.from,
        password: blank(body.password) ? 'kept' : 'replaced',
      },
    });
    await this.app.valkey.publish(INTEGRATIONS_CHANNEL, 'smtp');
    return this.smtpStatus();
  }

  /** Sends one email through the server in use, to the admin asking. */
  async testSmtp(to: { email: string; name: string }): Promise<void> {
    this.app.mailer.reset();
    try {
      await this.app.mailer.send({
        to: to.email,
        subject: 'Test email from the CRM',
        text: `Hello ${to.name},\n\nThis is a test from Settings. If you can read it, email from the CRM is working.\n`,
        html: `<p>Hello ${to.name.replace(/[<>&"]/g, '')},</p><p>This is a test from Settings. If you can read it, email from the CRM is working.</p>`,
      });
    } catch (err) {
      throw new ServiceUnavailableError(`The test email was not sent: ${reasonOf(err)}`);
    }
  }

  // ── PBX ────────────────────────────────────────────────────────────────────────────────

  async pbxStatus(): Promise<PbxStatusDto> {
    const p = await readPbx(this.app.db, this.app.config);
    const connected = this.app.cti.enabled && (await readCtiStatus(this.app.valkey)).connected;
    return {
      source: p.source,
      enabled: p.enabled,
      baseUrl: p.baseUrl,
      clientId: p.clientId,
      secretSet: Boolean(p.clientSecret),
      tls: p.tlsMode,
      fingerprint: p.tls.fingerprintSha256 ?? null,
      connected,
      updatedAt: p.updatedAt?.toISOString() ?? null,
    };
  }

  async savePbx(actorId: string, body: PbxConfigBody, ctx: AuditContext): Promise<PbxStatusDto> {
    if (body.confirmReconnect !== true) {
      throw new ValidationError([
        {
          path: 'confirmReconnect',
          message: 'Saving reconnects the phone system for everyone. Confirm to go ahead.',
        },
      ]);
    }
    const current = await readPbx(this.app.db, this.app.config);
    const baseUrl = body.baseUrl.replace(/\/+$/, '');
    if (
      this.app.config.NODE_ENV === 'production' &&
      !baseUrl.startsWith('https://') &&
      !isOnThisMachine(baseUrl)
    ) {
      throw new ValidationError([
        { path: 'baseUrl', message: 'The PBX address must start with https://' },
      ]);
    }
    // A blank secret keeps the one in use, but only for the same PBX and the same client ID.
    const sameKey = current.baseUrl === baseUrl && current.clientId === body.clientId;
    const clientSecret = !blank(body.clientSecret)
      ? (body.clientSecret ?? '')
      : sameKey
        ? (current.clientSecret ?? '')
        : '';
    if (clientSecret === '') {
      throw new ValidationError([{ path: 'clientSecret', message: 'Enter the API client secret' }]);
    }
    const stored: StoredPbx = {
      enabled: body.enabled,
      baseUrl,
      clientId: body.clientId,
      clientSecret,
      tls: body.tls,
      fingerprint:
        body.tls === 'fingerprint' && !blank(body.fingerprint) ? (body.fingerprint ?? null) : null,
    };

    if (stored.enabled) await this.tryPbx(stored);

    await writeIntegration(this.app.db, 'pbx', stored, this.app.config.SECRETS_KEY, actorId);
    await this.app.audit.write(ctx, {
      action: 'integration.pbx_configured',
      entity: 'system',
      before:
        current.baseUrl === null
          ? null
          : { enabled: current.enabled, baseUrl: current.baseUrl, clientId: current.clientId },
      after: {
        enabled: stored.enabled,
        baseUrl: stored.baseUrl,
        clientId: stored.clientId,
        tls: stored.tls,
        secret: blank(body.clientSecret) ? 'kept' : 'replaced',
      },
    });
    await this.app.valkey.publish(INTEGRATIONS_CHANNEL, 'pbx');
    return this.pbxStatus();
  }

  /**
   * Asks the PBX for a token with these details and hands it straight back. Proves the address,
   * the certificate trust and the API key in one go, and leaves nothing live behind.
   */
  private async tryPbx(p: StoredPbx): Promise<void> {
    let token: string | null = null;
    const client = new YeastarClient({
      baseUrl: p.baseUrl,
      tls: p.tls === 'fingerprint' && p.fingerprint ? { fingerprintSha256: p.fingerprint } : {},
      getAccessToken: () =>
        token === null ? Promise.reject(new Error('no token')) : Promise.resolve(token),
      onTokenRejected: () => Promise.reject(new Error('token rejected')),
      log: this.app.log,
    });
    try {
      let res;
      try {
        res = await client.rawPost(
          '/get_token',
          { username: p.clientId, password: p.clientSecret },
          tokenResponse,
        );
      } catch (err) {
        throw new ServiceUnavailableError(
          `Could not reach the PBX at ${p.baseUrl}: ${reasonOf(err)}`,
        );
      }
      if (res.errcode !== 0 || !res.access_token) {
        throw new ValidationError([
          {
            path: 'clientSecret',
            message:
              `The PBX refused this client ID and secret (${String(res.errcode)} ${res.errmsg ?? ''})`.trim(),
          },
        ]);
      }
      token = res.access_token;
      await client.call('GET', '/del_token', { schema: tokenResponse }).catch((err: unknown) => {
        this.app.log.warn({ err }, 'could not hand back the PBX test token');
      });
    } finally {
      await client.close();
    }
  }

  /** Drops what was saved here and goes back to the server's .env. */
  async reset(key: IntegrationKey, ctx: AuditContext): Promise<void> {
    const removed = await this.app.db.integrationConfig.deleteMany({ where: { key } });
    if (removed.count === 0) return;
    await this.app.audit.write(ctx, {
      action: `integration.${key}_reset`,
      entity: 'system',
      after: { source: 'server' },
    });
    await this.app.valkey.publish(INTEGRATIONS_CHANNEL, key);
  }
}
