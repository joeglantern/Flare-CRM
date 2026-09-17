/**
 * Single-token lifecycle shared by api and worker via Valkey (docs/06 §4).
 * Yeastar caps an application at 8 live tokens, so exactly one is created and reused.
 */
import type { Redis } from 'ioredis';
import { PbxUnavailableError } from '../../lib/errors.js';
import { tokenResponse, type YeastarClient } from './client.js';

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number; // epoch ms
  refreshExpiresAt: number;
}

const KEY = 'cti:token';
const LOCK = 'cti:token:lock';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class TokenManager {
  constructor(
    private readonly valkey: Redis,
    private readonly credentials: { clientId: string; clientSecret: string },
    private readonly client: YeastarClient,
    private readonly log: {
      info: (o: unknown, m: string) => void;
      warn: (o: unknown, m: string) => void;
    },
  ) {}

  async read(): Promise<StoredToken | null> {
    const raw = await this.valkey.get(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredToken;
    } catch {
      return null;
    }
  }

  /** Access token for API calls; obtains/refreshes when missing or about to expire. */
  async getAccessToken(): Promise<string> {
    const current = await this.read();
    if (current && current.accessExpiresAt - Date.now() > REFRESH_MARGIN_MS)
      return current.accessToken;
    return (await this.renew(current)).accessToken;
  }

  /**
   * A fresh token, after the PBX has just refused the one we were using.
   *
   * This used to throw the stored token away before renewing, which meant `renew` always fell
   * through to a brand new `/get_token` authentication rather than a `/refresh_token` exchange.
   * The PBX caps an application at eight live tokens (see the file comment), and a fresh
   * authentication is what counts against that cap; a refresh reuses the slot it already holds.
   * Called from three independent places (a reconnect, a ten-minute cron, and a keep-alive ping),
   * each rejection was quietly minting a brand new token, and the cap was exhausted within
   * minutes of a genuinely broken call (one that fails for a reason no new token would fix)
   * repeating on any of those schedules. Passing the current token through gives `renew` the
   * chance to refresh first, exactly as it already does on the ordinary expiry path, and it still
   * falls back to a full authentication when there is nothing to refresh or the refresh itself is
   * refused.
   */
  async invalidateAndRenew(): Promise<string> {
    return (await this.renew(await this.read())).accessToken;
  }

  async renew(current: StoredToken | null): Promise<StoredToken> {
    const lock = await this.valkey.set(LOCK, '1', 'PX', 10_000, 'NX');
    if (lock !== 'OK') {
      // another process is renewing — wait briefly and re-read
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const t = await this.read();
        if (t && t.accessExpiresAt - Date.now() > REFRESH_MARGIN_MS) return t;
      }
      throw new PbxUnavailableError('Timed out waiting for PBX token renewal');
    }
    try {
      let res =
        current && current.refreshExpiresAt - Date.now() > 60_000
          ? await this.tryRefresh(current.refreshToken)
          : null;
      res ??= await this.client.rawPost(
        '/get_token',
        { username: this.credentials.clientId, password: this.credentials.clientSecret },
        tokenResponse,
      );
      if (res.errcode !== 0 || !res.access_token || !res.refresh_token) {
        throw new PbxUnavailableError(
          `PBX token request failed: ${res.errcode} ${res.errmsg ?? ''}`,
        );
      }
      const now = Date.now();
      const token: StoredToken = {
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        accessExpiresAt: now + (res.access_token_expire_time ?? 1800) * 1000,
        refreshExpiresAt: now + (res.refresh_token_expire_time ?? 86_400) * 1000,
      };
      await this.valkey.set(KEY, JSON.stringify(token));
      this.log.info(
        { accessExpiresAt: new Date(token.accessExpiresAt).toISOString() },
        'PBX token renewed',
      );
      return token;
    } finally {
      await this.valkey.del(LOCK);
    }
  }

  private async tryRefresh(refreshToken: string) {
    try {
      const res = await this.client.rawPost(
        '/refresh_token',
        { refresh_token: refreshToken },
        tokenResponse,
      );
      if (res.errcode === 0 && res.access_token) return res;
      this.log.warn(
        { errcode: res.errcode },
        'PBX refresh_token rejected; falling back to get_token',
      );
      return null;
    } catch (err) {
      this.log.warn({ err }, 'PBX refresh_token failed; falling back to get_token');
      return null;
    }
  }

  /** Revoke on graceful shutdown so the 8-token cap is never exhausted by restarts. */
  async revoke(): Promise<void> {
    const current = await this.read();
    if (!current) return;
    try {
      await this.client.call('GET', '/del_token', { schema: tokenResponse });
    } catch (err) {
      this.log.warn({ err }, 'PBX del_token failed');
    }
    await this.valkey.del(KEY);
  }
}
