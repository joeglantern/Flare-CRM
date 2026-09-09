/*
 * Copied from apps/api. The two services are deliberately separate processes with
 * separate databases; this plumbing is identical in both. Candidate for a shared server
 * package once something needs it a third time.
 */
/**
 * Pino logger options (docs/08 F3, docs/14 §5). PII and secrets are redacted.
 */
import type { LoggerOptions } from 'pino';
import type { Env } from './env.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.access_token',
  '*.refresh_token',
  '*.secret',
  '*.clientSecret',
  '*.client_secret',
  '*.apiKey',
  '*.backupCodes',
  '*.body', // message bodies
];

export function buildLoggerOptions(env: Env): LoggerOptions {
  const base: LoggerOptions = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      req(req: { method: string; url: string; id: unknown; ip?: string }) {
        return { method: req.method, url: stripAccessToken(req.url), id: req.id, ip: req.ip };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
    },
  };
  if (env.NODE_ENV === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    };
  }
  return base;
}

/** Yeastar passes tokens in the query string; never let them reach logs. */
export function stripAccessToken(url: string): string {
  return url.replace(/([?&]access_token=)[^&]+/gi, '$1[REDACTED]');
}
