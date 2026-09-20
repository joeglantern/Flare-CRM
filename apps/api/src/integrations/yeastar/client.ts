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

/**
 * Error codes that mean the token is no longer good for anything.
 *
 * Only the 100xx family. 40002 used to be in here as part of a supposed "token family", and it is
 * not: it is PARAMETER ERROR, which the PBX returns with an `invalid_param_list` naming the
 * parameters it did not like. Treating it as a dead token meant every malformed request threw away a
 * working token and authenticated again, and the PBX caps an application at eight live tokens. The
 * CDR reconciler sent a wall clock where unix seconds were required, every ten minutes, so it earned
 * a 40002 and burned a grant each time until the cap was exhausted and telephony stopped. A bad
 * parameter must fail as a bad parameter; nothing about a new token would fix it.
 *
 * 40003 and 40004 went with it: they are the same 400xx request-level family, and a genuine token
 * problem always arrives as one of the 100xx codes below.
 */
const TOKEN_ERRORS = new Set([10004, 10005, 10006]);

export const tokenResponse = z.object({
  errcode: z.number().int(),
  errmsg: z.string().optional(),
  access_token: z.string().optional(),
  access_token_expire_time: z.coerce.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expire_time: z.coerce.number().optional(),
});
export type TokenResponse = z.infer<typeof tokenResponse>;

/** A contact as the PBX lists it: one field per number slot, and the phonebooks it belongs to. */
export const companyContactRow = z
  .object({
    id: z.coerce.number(),
    contact_name: z.string().optional(),
    company: z.string().optional(),
    email: z.string().optional(),
    business: z.string().optional(),
    business2: z.string().optional(),
    mobile: z.string().optional(),
    mobile2: z.string().optional(),
    home: z.string().optional(),
    home2: z.string().optional(),
    other: z.string().optional(),
  })
  .loose();
export type CompanyContactRow = z.infer<typeof companyContactRow>;

export const NUMBER_SLOTS = [
  'mobile_number',
  'business_number',
  'home_number',
  'mobile_number2',
  'business_number2',
  'home_number2',
  'other_number',
] as const;
export type NumberSlot = (typeof NUMBER_SLOTS)[number];

/** What create and update accept. `first_name` and `number_list` are the only required fields. */
export interface CompanyContactWrite {
  first_name: string;
  last_name?: string;
  company?: string;
  email?: string;
  job_title?: string;
  number_list: { num_type: NumberSlot; number: string }[];
}

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

  /**
   * `start_time` and `end_time` are unix seconds. The endpoint validates them and refuses a
   * formatted wall-clock string with a parameter error, unlike most of this API which ignores what
   * it does not recognise.
   */
  cdrSearch(query: { start_time?: number; end_time?: number; page?: number; page_size?: number }) {
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

  // ── Company contacts and phonebooks (docs/06 §17) ────────────────────────────────────────

  /**
   * One page of the PBX's company contacts. The default page size is the maximum the API allows,
   * so a fleet of a few thousand contacts is two or three requests rather than a hundred.
   *
   * Numbers come back as one field per slot (`business`, `mobile`, `home` and their seconds) rather
   * than as the `number_list` array that create and update take, so the two shapes differ in the
   * same API and the mapping has to be written twice.
   */
  companyContactList(query: { page?: number; page_size?: number } = {}) {
    return this.call('GET', '/company_contact/list', {
      query: { page: query.page ?? 1, page_size: query.page_size ?? 1000 },
      schema: z
        .object({
          total_number: z.coerce.number().optional(),
          data: z.array(companyContactRow).optional(),
        })
        .loose(),
    });
  }

  companyContactCreate(body: CompanyContactWrite) {
    return this.call('POST', '/company_contact/create', {
      body,
      schema: z.object({ id: z.coerce.number() }).loose(),
    });
  }

  companyContactUpdate(body: CompanyContactWrite & { id: number }) {
    return this.call('POST', '/company_contact/update', { body, schema: z.object({}).loose() });
  }

  /** One at a time: the API takes a single id and has no bulk form. */
  companyContactDelete(id: number) {
    return this.call('GET', '/company_contact/delete', {
      query: { id },
      schema: z.object({}).loose(),
    });
  }

  phonebookList(query: { page?: number; page_size?: number } = {}) {
    return this.call('GET', '/phonebook/list', {
      query: { page: query.page ?? 1, page_size: query.page_size ?? 1000 },
      schema: z
        .object({
          data: z
            .array(z.object({ id: z.coerce.number(), name: z.string().optional() }).loose())
            .optional(),
        })
        .loose(),
    });
  }

  /**
   * `sel_all` rather than a list of ids on purpose: a phonebook that names its members has to be
   * edited every time a contact is added or removed, and the day that edit fails the phonebook and
   * the contacts disagree. "Everyone" cannot drift.
   */
  phonebookCreate(body: { name: string; member_select: 'sel_all' | 'sel_specific' }) {
    return this.call('POST', '/phonebook/create', {
      body,
      schema: z.object({ id: z.coerce.number().optional() }).loose(),
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
