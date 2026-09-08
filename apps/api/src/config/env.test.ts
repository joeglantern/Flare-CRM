import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base: Record<string, string> = {
  NODE_ENV: 'production',
  APP_URL: 'https://crm.example.com',
  AUTH_SECRET: 'x'.repeat(48),
  SECRETS_KEY: 'ab'.repeat(32),
  DATABASE_URL: 'postgresql://u:p@db:5432/crm',
  VALKEY_URL: 'redis://:p@valkey:6379/0',
  S3_ENDPOINT: 'http://seaweedfs:8333',
  S3_BUCKET: 'crm',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  SMTP_URL: 'smtps://u:p@smtp.example.com:465',
  MAIL_FROM: 'CRM <no-reply@example.com>',
};

describe('loadEnv', () => {
  it('accepts a complete production configuration', () => {
    const env = loadEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.YEASTAR_ENABLED).toBe(false);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('rejects weak secrets', () => {
    expect(() => loadEnv({ ...base, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
    expect(() => loadEnv({ ...base, SECRETS_KEY: 'nothex' })).toThrow(/SECRETS_KEY/);
  });

  it('requires https APP_URL in production', () => {
    expect(() => loadEnv({ ...base, APP_URL: 'http://crm.example.com' })).toThrow(/https/);
  });

  it('requires PBX credentials and certificate pin when Yeastar is enabled in production', () => {
    expect(() => loadEnv({ ...base, YEASTAR_ENABLED: 'true' })).toThrow(/YEASTAR_BASE_URL/);
    expect(() =>
      loadEnv({
        ...base,
        YEASTAR_ENABLED: 'true',
        YEASTAR_BASE_URL: 'https://10.8.0.2:8088',
        YEASTAR_CLIENT_ID: 'id',
        YEASTAR_CLIENT_SECRET: 'secret',
      }),
    ).toThrow(/YEASTAR_TLS_FINGERPRINT_SHA256/);
    const ok = loadEnv({
      ...base,
      YEASTAR_ENABLED: 'true',
      YEASTAR_BASE_URL: 'https://10.8.0.2:8088',
      YEASTAR_CLIENT_ID: 'id',
      YEASTAR_CLIENT_SECRET: 'secret',
      YEASTAR_TLS_FINGERPRINT_SHA256: Array.from({ length: 32 }, () => 'AB').join(':'),
    });
    expect(ok.YEASTAR_EVENT_SOURCE).toBe('websocket');
  });

  it('accepts a publicly trusted PBX certificate without a pin, and refuses both together', () => {
    const cloud = {
      ...base,
      YEASTAR_ENABLED: 'true',
      YEASTAR_BASE_URL: 'https://tenant.ras.yeastar.com',
      YEASTAR_CLIENT_ID: 'id',
      YEASTAR_CLIENT_SECRET: 'secret',
    };
    expect(() => loadEnv(cloud)).toThrow(/YEASTAR_TLS_PUBLIC_CA/);
    expect(loadEnv({ ...cloud, YEASTAR_TLS_PUBLIC_CA: 'true' }).YEASTAR_TLS_PUBLIC_CA).toBe(true);
    expect(loadEnv({ ...cloud, YEASTAR_TLS_CA_FILE: '/etc/pbx.pem' }).YEASTAR_TLS_CA_FILE).toBe(
      '/etc/pbx.pem',
    );
    expect(() =>
      loadEnv({
        ...cloud,
        YEASTAR_TLS_PUBLIC_CA: 'true',
        YEASTAR_TLS_FINGERPRINT_SHA256: Array.from({ length: 32 }, () => 'AB').join(':'),
      }),
    ).toThrow(/must not also be pinned/);
  });

  it('requires a webhook secret when webhook events are enabled', () => {
    expect(() =>
      loadEnv({
        ...base,
        YEASTAR_ENABLED: 'true',
        YEASTAR_BASE_URL: 'https://pbx.example.com',
        YEASTAR_CLIENT_ID: 'id',
        YEASTAR_CLIENT_SECRET: 'secret',
        YEASTAR_TLS_FINGERPRINT_SHA256: Array.from({ length: 32 }, () => '00').join(':'),
        YEASTAR_EVENT_SOURCE: 'both',
      }),
    ).toThrow(/YEASTAR_WEBHOOK_SECRET/);
  });
});
