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

  describe('the owner console link', () => {
    const linked = {
      ...base,
      CONSOLE_STACK_ID: 'stk_abcdefghijklmnopqrst',
      CONSOLE_STACK_SECRET: 'z'.repeat(43),
      CONSOLE_PUBLIC_KEY: 'MCowBQYDK2VwAyEA' + 'a'.repeat(28) + '=',
    };

    it('takes the console over https', () => {
      const env = loadEnv({ ...linked, CONSOLE_URL: 'https://console.example.com' });
      expect(env.CONSOLE_URL).toBe('https://console.example.com');
    });

    it('refuses a console reached over the internet in the clear', () => {
      expect(() => loadEnv({ ...linked, CONSOLE_URL: 'http://console.example.com' })).toThrow(
        /https/,
      );
    });

    it('allows plain http when the console is on this machine', () => {
      // A console sharing a host with its first customer stack (docs/21 §11): the link never
      // leaves the machine, so there is nothing on the wire to intercept.
      for (const url of [
        'http://172.17.0.1:4100',
        'http://127.0.0.1:4100',
        'http://localhost:4100',
        'http://10.0.0.5:4100',
        'http://192.168.1.20:4100',
        'http://host.docker.internal:4100',
      ]) {
        expect(loadEnv({ ...linked, CONSOLE_URL: url }).CONSOLE_URL).toBe(url);
      }
      // 172.32 is outside the private range and is somebody else's address.
      expect(() => loadEnv({ ...linked, CONSOLE_URL: 'http://172.32.0.1:4100' })).toThrow(/https/);
    });

    it('wants all of the credentials or none of them', () => {
      expect(() => loadEnv({ ...base, CONSOLE_URL: 'https://console.example.com' })).toThrow(
        /CONSOLE_STACK_ID/,
      );
    });
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
