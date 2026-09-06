/**
 * Typed Yeastar P-Series Open API client (docs/06 §3). Every request: `User-Agent: OpenAPI`,
 * JSON, token in the query string, 10 s timeout, one automatic retry after a token refresh.
 */
import {
  Agent,
  fetch as undiciFetch,
  type Dispatcher,
  type Response as UndiciResponse,
} from 'undici';
import { z } from 'zod';
import { PbxUnavailableError } from '../../lib/errors.js';
import { stripAccessToken } from '../../config/logger.js';
import { buildPbxTlsOptions } from './tls.js';

export interface YeastarClientOptions {
  baseUrl: string; // https://pbx:8088
  apiPath?: string; // /openapi/v1.0
  tls: { caFile?: string | undefined; fingerprintSha256?: string | undefined };
  getAccessToken: () => Promise<string>;
  onTokenRejected: () => Promise<string>;
  log: { warn: (o: unknown, m: string) => void; debug: (o: unknown, m: string) => void };
  timeoutMs?: number;
}

const baseResponse = z.object({ errcode: z.number().int(), errmsg: z.string().optional() }).loose();

export class YeastarApiError extends Error {
  constructor(
    readonly errcode: number,
    readonly errmsg: string,
    readonly path: string,
  ) {
    super(`Yeastar ${path} failed: ${errcode} ${errmsg}`);
    this.name = 'YeastarApiError';
  }
}

/** Error codes that mean "token invalid/expired" per the developer guide (10004/10005 family). */
const TOKEN_ERRORS = new Set([10004, 10005, 10006, 40002, 40003, 40004]);

export const tokenResponse = z.object({
  errcode: z.number().int(),
  errmsg: z.string().optional(),
  access_token: z.string().optional(),
  access_token_expire_time: z.coerce.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expire_time: z.coerce.number().optional(),
});
export type TokenResponse = z.infer<typeof tokenResponse>;

export class YeastarClient {
  private readonly dispatcher: Dispatcher;
  private readonly apiBase: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: YeastarClientOptions) {
    const tls = buildPbxTlsOptions(opts.tls);
    this.dispatcher = new Agent({ connect: { ...tls, timeout: 10_000 }, connections: 8 });
    this.apiBase = `${opts.baseUrl.replace(/\/+$/, '')}${opts.apiPath ?? '/openapi/v1.0'}`;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  get baseUrl(): string {
    return this.opts.baseUrl.replace(/\/+$/, '');
  }

  /** Raw call without token handling (used by the token manager). */
  async rawPost<T extends z.ZodType>(path: string, body: unknown, schema: T): Promise<z.infer<T>> {
    return this.send('POST', `${this.apiBase}${path}`, body, schema);
  }

  private async send<T extends z.ZodType>(
    method: 'GET' | 'POST',
    url: string,
    body: unknown,
    schema: T,
  ): Promise<z.infer<T>> {
    let res: UndiciResponse;
    try {
      res = await undiciFetch(url, {
        method,
        headers: {
          'User-Agent': 'OpenAPI',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
        dispatcher: this.dispatcher,
      });
    } catch (err) {
      throw new PbxUnavailableError(`PBX request failed (${stripAccessToken(url)})`, {
        cause: err,
      });
    }
    if (!res.ok)
      throw new PbxUnavailableError(`PBX returned HTTP ${res.status} for ${stripAccessToken(url)}`);
    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      this.opts.log.warn(
        { url: stripAccessToken(url), issues: parsed.error.issues.slice(0, 3) },
        'unexpected PBX response shape',
      );
      throw new PbxUnavailableError('Unexpected PBX response');
    }
    return parsed.data;
  }

  /** Authenticated request with token-error retry. */
  async call<T extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown; schema: T },
  ): Promise<z.infer<T>> {
    const attempt = async (token: string) => {
      const url = new URL(`${this.apiBase}${path}`);
      url.searchParams.set('access_token', token);
      for (const [k, v] of Object.entries(opts.query ?? {}))
        if (v !== undefined) url.searchParams.set(k, String(v));
      const data = await this.send(method, url.toString(), opts.body, baseResponse);
      if (data.errcode !== 0)
        throw new YeastarApiError(data.errcode, data.errmsg ?? 'FAILURE', path);
      const parsed = opts.schema.safeParse(data);
      if (!parsed.success) throw new PbxUnavailableError('Unexpected PBX response');
      return parsed.data;
    };
    try {
      return await attempt(await this.opts.getAccessToken());
    } catch (err) {
      if (err instanceof YeastarApiError && TOKEN_ERRORS.has(err.errcode)) {
        this.opts.log.warn({ errcode: err.errcode }, 'PBX token rejected; refreshing once');
        return attempt(await this.opts.onTokenRejected());
      }
      throw err;
    }
  }

  // ── Call control (docs/06 §3) ────────────────────────────────────────────────────────────

  dial(body: {
    caller: string;
    callee: string;
    dial_permission?: string;
    auto_answer?: 'yes' | 'no';
  }) {
    return this.call('POST', '/call/dial', {
      body,
      schema: z.object({ call_id: z.string() }).loose(),
    });
  }
  queryCall(query: {
    call_id?: string;
    type?: 'inbound' | 'outbound' | 'internal';
    extension?: string;
  }) {
    return this.call('GET', '/call/query', {
      query,
      schema: z.object({ data: z.array(z.unknown()).optional() }).loose(),
    });
  }
  hangup(channel_id: string) {
    return this.call('POST', '/call/hangup', { body: { channel_id }, schema: baseResponse });
  }
  hold(channel_id: string) {
    return this.call('POST', '/call/hold', { body: { channel_id }, schema: baseResponse });
  }
  unhold(channel_id: string) {
    return this.call('POST', '/call/unhold', { body: { channel_id }, schema: baseResponse });
  }
  mute(channel_id: string) {
    return this.call('POST', '/call/mute', { body: { channel_id }, schema: baseResponse });
  }
  unmute(channel_id: string) {
    return this.call('POST', '/call/unmute', { body: { channel_id }, schema: baseResponse });
  }
  transfer(body: { channel_id: string; number: string; type: 'blind' | 'attended' }) {
    return this.call('POST', '/call/transfer', { body, schema: baseResponse });
  }
  acceptInbound(body: { channel_id: string; extension?: string }) {
    return this.call('POST', '/call/accept_inbound', { body, schema: baseResponse });
  }
  refuseInbound(channel_id: string) {
    return this.call('POST', '/call/refuse_inbound', {
      body: { channel_id },
      schema: baseResponse,
    });
  }
  recordPause(channel_id: string) {
    return this.call('POST', '/call/record_pause', { body: { channel_id }, schema: baseResponse });
  }

  // ── CDR & recordings ─────────────────────────────────────────────────────────────────────

  cdrSearch(query: {
    start_time?: string;
    end_time?: string;
    page?: number;
    page_size?: number;
    sort_by?: string;
    order_by?: 'asc' | 'desc';
  }) {
    return this.call('GET', '/cdr/search', {
      query,
      schema: z
        .object({
          total_number: z.coerce.number().optional(),
          data: z.array(z.unknown()).optional(),
        })
        .loose(),
    });
  }
  recordingDownloadUrl(query: { id?: number; file?: string }) {
    return this.call('GET', '/recording/download', {
      query,
      schema: z.object({ file: z.string().optional(), download_resource_url: z.string() }).loose(),
    });
  }

  /** Streams a recording using the temporary path returned by recordingDownloadUrl (30-min validity). */
  async downloadResource(downloadResourceUrl: string): Promise<{
    body: ReadableStream<Uint8Array>;
    contentType: string;
    contentLength: number | undefined;
  }> {
    if (!downloadResourceUrl.startsWith('/'))
      throw new PbxUnavailableError('Refusing non-relative PBX download URL'); // SSRF guard (docs/08 I2)
    const token = await this.opts.getAccessToken();
    const url = new URL(`${this.baseUrl}${downloadResourceUrl}`);
    url.searchParams.set('access_token', token);
    let res: UndiciResponse;
    try {
      res = await undiciFetch(url, {
        headers: { 'User-Agent': 'OpenAPI' },
        signal: AbortSignal.timeout(120_000),
        dispatcher: this.dispatcher,
      });
    } catch (err) {
      throw new PbxUnavailableError('Recording download failed', { cause: err });
    }
    if (!res.ok || !res.body)
      throw new PbxUnavailableError(`Recording download returned HTTP ${res.status}`);
    const len = res.headers.get('content-length');
    return {
      body: res.body,
      contentType: res.headers.get('content-type') ?? 'audio/wav',
      contentLength: len ? Number(len) : undefined,
    };
  }

  // ── Linkus SDK ───────────────────────────────────────────────────────────────────────────

  linkusSign(body: { username: string; sign_type: 'sdk'; expire_time: number }) {
    return this.call('POST', '/sign/create', {
      body,
      schema: z
        .object({
          data: z.object({ sign: z.string() }).loose().optional(),
          sign: z.string().optional(),
        })
        .loose(),
    });
  }

  extensionList(query: { page?: number; page_size?: number } = {}) {
    return this.call('GET', '/extension/list', {
      query,
      schema: z
        .object({ data: z.array(z.object({ number: z.string().optional() }).loose()).optional() })
        .loose(),
    });
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }
}
