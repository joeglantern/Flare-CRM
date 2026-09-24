/**
 * In-process Yeastar P-Series look-alike (docs/06 §15): REST endpoints for tokens, dial, call
 * control, CDR search and recording download, plus the `/subscribe` WebSocket that pushes events.
 * Records every request so tests can assert what the CRM sent to the PBX.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export class FakePbx {
  readonly requests: RecordedRequest[] = [];
  readonly sockets = new Set<WebSocket>();
  cdrs: unknown[] = [];
  /** What the PBX answers for its extension list; a test sets the emails it needs. */
  extensions: { number: string; caller_id_name?: string; email_addr?: string }[] = [
    { number: '1001' },
    { number: '1002' },
  ];
  /** Company contacts, keyed by the id the PBX hands out. */
  contacts = new Map<number, Record<string, unknown>>();
  phonebooks: { id: number; name: string; member_select?: string }[] = [];
  /** What `GET /call/query` answers: calls in progress, in the 30011 member layout. */
  liveCalls: { call_id: string; members: object[] }[] = [];
  /** First names the PBX will refuse to create, so a test can fail one contact and not the rest. */
  refuseContactNames = new Set<string>();
  private contactSeq = 0;
  private phonebookSeq = 0;
  recordingBytes = Buffer.from('RIFF....WAVEfmt fake-audio-bytes');
  tokenCounter = 0;
  dialCounter = 0;
  rejectNextTokenUse = false;
  private app: FastifyInstance | null = null;
  private wss: WebSocketServer | null = null;
  url = '';

  async start(): Promise<string> {
    const app = Fastify({ logger: false });
    this.app = app;

    app.addHook('onRequest', (request, _reply, done) => {
      this.requests.push({
        method: request.method,
        path: request.url.split('?')[0] ?? '',
        query: request.query as Record<string, string>,
        body: undefined,
      });
      done();
    });
    app.addHook('preHandler', (request, _reply, done) => {
      const last = this.requests.at(-1);
      if (last) last.body = request.body;
      done();
    });

    const authed = (request: { query: unknown }): boolean => {
      const q = request.query as Record<string, string>;
      if (this.rejectNextTokenUse) {
        this.rejectNextTokenUse = false;
        return false;
      }
      return typeof q.access_token === 'string' && q.access_token.startsWith('tok-');
    };

    app.post('/openapi/v1.0/get_token', async () => {
      this.tokenCounter++;
      return {
        errcode: 0,
        errmsg: 'SUCCESS',
        access_token: `tok-${this.tokenCounter}`,
        access_token_expire_time: 1800,
        refresh_token: `ref-${this.tokenCounter}`,
        refresh_token_expire_time: 86400,
      };
    });
    app.post('/openapi/v1.0/refresh_token', async () => {
      this.tokenCounter++;
      return {
        errcode: 0,
        errmsg: 'SUCCESS',
        access_token: `tok-${this.tokenCounter}`,
        access_token_expire_time: 1800,
        refresh_token: `ref-${this.tokenCounter}`,
        refresh_token_expire_time: 86400,
      };
    });
    app.get('/openapi/v1.0/del_token', async () => ({ errcode: 0, errmsg: 'SUCCESS' }));

    app.post('/openapi/v1.0/call/dial', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      this.dialCounter++;
      return { errcode: 0, errmsg: 'SUCCESS', call_id: `dial.${this.dialCounter}` };
    });
    for (const action of [
      'hangup',
      'hold',
      'unhold',
      'mute',
      'unmute',
      'transfer',
      'accept_inbound',
      'refuse_inbound',
      'record_pause',
    ]) {
      app.post(`/openapi/v1.0/call/${action}`, async (request) =>
        authed(request)
          ? { errcode: 0, errmsg: 'SUCCESS' }
          : { errcode: 10004, errmsg: 'Invalid token' },
      );
    }
    app.get('/openapi/v1.0/call/query', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      const ext = (request.query as Record<string, string | undefined>).extension;
      const onExt = (c: { members: object[] }) =>
        ext === undefined ||
        c.members.some((m) => (m as { extension?: { number?: string } }).extension?.number === ext);
      return { errcode: 0, errmsg: 'SUCCESS', data: this.liveCalls.filter(onExt) };
    });
    app.get('/openapi/v1.0/cdr/search', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      // The real endpoint takes unix seconds here and answers 40002 to anything else, including the
      // wall-clock string the events use. Reproduced, because a caller that gets this wrong
      // otherwise looks like a PBX with no calls in it.
      const q = request.query as Record<string, string | undefined>;
      for (const key of ['start_time', 'end_time']) {
        const value = q[key];
        if (value !== undefined && !/^\d+$/.test(value)) {
          return { errcode: 40002, errmsg: `The parameter ${key} is invalid.` };
        }
      }
      return { errcode: 0, errmsg: 'SUCCESS', total_number: this.cdrs.length, data: this.cdrs };
    });
    app.get('/openapi/v1.0/recording/download', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      const q = request.query as Record<string, string>;
      return {
        errcode: 0,
        errmsg: 'SUCCESS',
        file: q.file ?? 'rec.wav',
        download_resource_url: `/api/download/Recording-${encodeURIComponent(q.file ?? 'rec.wav')}`,
      };
    });
    app.get('/api/download/*', async (request, reply) => {
      if (!authed(request)) return reply.status(403).send('forbidden');
      return reply.header('content-type', 'audio/wav').send(this.recordingBytes);
    });
    app.post('/openapi/v1.0/sign/create', async () => ({
      errcode: 0,
      errmsg: 'SUCCESS',
      data: { sign: 'fake-sign' },
    }));
    // ── company contacts and phonebooks ────────────────────────────────────────────────
    // Numbers go in as a `number_list` array and come back as one field per slot, which is how the
    // real API behaves and the reason the mapping has to be written twice.
    const slotField: Record<string, string> = {
      mobile_number: 'mobile',
      mobile_number2: 'mobile2',
      business_number: 'business',
      business_number2: 'business2',
      home_number: 'home',
      home_number2: 'home2',
      other_number: 'other',
    };
    const toRow = (id: number, body: Record<string, unknown>): Record<string, unknown> => {
      const numbers = Array.isArray(body.number_list)
        ? (body.number_list as { num_type: string; number: string }[])
        : [];
      const row: Record<string, unknown> = {
        id,
        contact_name: [body.first_name, body.last_name].filter(Boolean).join(' '),
        company: body.company ?? '',
        email: body.email ?? '',
        job_title: body.job_title ?? '',
      };
      for (const field of Object.values(slotField)) row[field] = '';
      for (const n of numbers) {
        const field = slotField[n.num_type];
        if (field) row[field] = n.number;
      }
      return row;
    };

    app.get('/openapi/v1.0/company_contact/list', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      const q = request.query as Record<string, string | undefined>;
      const size = Number(q.page_size ?? '10000');
      const page = Number(q.page ?? '1');
      const all = [...this.contacts.values()];
      return {
        errcode: 0,
        errmsg: 'SUCCESS',
        total_number: all.length,
        data: all.slice((page - 1) * size, page * size),
      };
    });
    app.post('/openapi/v1.0/company_contact/create', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body.first_name !== 'string' || body.first_name === '')
        return { errcode: 40002, errmsg: 'The parameter first_name is invalid.' };
      if (this.refuseContactNames.has(body.first_name))
        return { errcode: 40003, errmsg: 'The contact could not be created.' };
      const id = ++this.contactSeq;
      this.contacts.set(id, toRow(id, body));
      return { errcode: 0, errmsg: 'SUCCESS', id };
    });
    app.post('/openapi/v1.0/company_contact/update', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const id = Number(body.id);
      const existing = this.contacts.get(id);
      if (!existing) return { errcode: 40003, errmsg: 'The contact does not exist.' };
      // Every field of an update is optional, so this treats one left out as unchanged, the
      // stricter reading: a sync that relies on omission to clear a field fails here as it would
      // on a PBX that behaves this way. A number_list that is sent replaces the numbers.
      const next = toRow(id, body);
      const names = (typeof existing.contact_name === 'string' ? existing.contact_name : '').split(
        ' ',
      );
      const first = typeof body.first_name === 'string' ? body.first_name : (names[0] ?? '');
      const last = typeof body.last_name === 'string' ? body.last_name : names.slice(1).join(' ');
      const merged: Record<string, unknown> = {
        ...existing,
        contact_name: [first, last].filter(Boolean).join(' '),
      };
      for (const key of ['company', 'email', 'job_title'])
        if (typeof body[key] === 'string') merged[key] = body[key];
      if (Array.isArray(body.number_list))
        for (const field of Object.values(slotField)) merged[field] = next[field];
      this.contacts.set(id, merged);
      return { errcode: 0, errmsg: 'SUCCESS' };
    });
    app.get('/openapi/v1.0/company_contact/delete', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      const q = request.query as Record<string, string>;
      this.contacts.delete(Number(q.id));
      return { errcode: 0, errmsg: 'SUCCESS' };
    });
    app.get('/openapi/v1.0/phonebook/list', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      return { errcode: 0, errmsg: 'SUCCESS', data: this.phonebooks };
    });
    app.post('/openapi/v1.0/phonebook/create', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
      const body = (request.body ?? {}) as Record<string, unknown>;
      // The real PBX allows one "all company contacts" phonebook, and refuses a second.
      if (
        body.member_select === 'sel_all' &&
        this.phonebooks.some((p) => p.member_select === 'sel_all')
      ) {
        return { errcode: 40003, errmsg: 'DUPLICATE KEY VALUE' };
      }
      const id = ++this.phonebookSeq;
      this.phonebooks.push({
        id,
        name: typeof body.name === 'string' ? body.name : '',
        ...(typeof body.member_select === 'string' ? { member_select: body.member_select } : {}),
      });
      return { errcode: 0, errmsg: 'SUCCESS', id };
    });

    app.get('/openapi/v1.0/extension/list', async () => ({
      errcode: 0,
      errmsg: 'SUCCESS',
      total_number: this.extensions.length,
      data: this.extensions,
    }));

    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;
    app.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (
        url.pathname !== '/openapi/v1.0/subscribe' ||
        !(url.searchParams.get('access_token') ?? '').startsWith('tok-')
      ) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.sockets.add(ws);
        ws.on('message', (data) => {
          const text = Buffer.isBuffer(data)
            ? data.toString('utf8')
            : Array.isArray(data)
              ? Buffer.concat(data).toString('utf8')
              : Buffer.from(data).toString('utf8');
          if (text === 'heartbeat') {
            ws.send('heartbeat response');
            return;
          }
          try {
            const msg = JSON.parse(text) as { topic_list?: number[] };
            if (msg.topic_list) ws.send(JSON.stringify({ errcode: 0, errmsg: 'SUCCESS' }));
          } catch {
            ws.send(JSON.stringify({ errcode: 1, errmsg: 'bad json' }));
          }
        });
        ws.on('close', () => this.sockets.delete(ws));
      });
    });

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    this.url = address;
    return address;
  }

  /**
   * Push an event to every subscribed CRM socket, framed the way the real PBX frames it: `msg` is
   * a JSON string inside the JSON frame, not a nested object. The builders below hand over objects
   * for readability; encoding happens here so every test exercises the shape production sees.
   */
  emit(event: unknown): void {
    const framed =
      typeof event === 'object' && event !== null && 'msg' in event
        ? { ...event, msg: JSON.stringify(event.msg) }
        : event;
    const text = JSON.stringify(framed);
    for (const ws of this.sockets) ws.send(text);
  }

  dropSockets(): void {
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
  }

  requestsTo(path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.path === path);
  }

  async stop(): Promise<void> {
    this.dropSockets();
    this.wss?.close();
    await this.app?.close();
  }
}

// ── event builders (shapes from the Yeastar developer guide) ────────────────────────────

let seq = 100;
export const nextCallId = () => `${Math.floor(Date.now() / 1000)}.${seq++}`;

export function inboundRinging(
  callId: string,
  from: string,
  extension: string,
  opts: { did?: string; trunk?: string } = {},
) {
  return {
    type: 30011,
    sn: 'FAKE0001',
    msg: {
      call_id: callId,
      members: [
        {
          inbound: {
            from,
            to: opts.did ?? '0200000000',
            trunk_name: opts.trunk ?? 'trunk-1',
            channel_id: `PJSIP/trunk-${callId}`,
            member_status: 'ANSWERED',
            call_path: '',
          },
        },
        {
          extension: {
            number: extension,
            channel_id: `PJSIP/${extension}-${callId}`,
            member_status: 'RING',
            call_path: '',
          },
        },
      ],
    },
  };
}

export function inboundAnswered(callId: string, from: string, extension: string) {
  const e = inboundRinging(callId, from, extension);
  (e.msg.members[1] as { extension: { member_status: string } }).extension.member_status =
    'ANSWERED';
  return e;
}

export function inboundBye(callId: string, from: string, extension: string) {
  const e = inboundRinging(callId, from, extension);
  (e.msg.members[0] as { inbound: { member_status: string } }).inbound.member_status = 'BYE';
  (e.msg.members[1] as { extension: { member_status: string } }).extension.member_status = 'BYE';
  return e;
}

export function outboundRinging(callId: string, extension: string, to: string) {
  return {
    type: 30011,
    sn: 'FAKE0001',
    msg: {
      call_id: callId,
      members: [
        {
          extension: {
            number: extension,
            channel_id: `PJSIP/${extension}-${callId}`,
            member_status: 'ANSWERED',
            call_path: '',
          },
        },
        {
          outbound: {
            from: extension,
            to,
            trunk_name: 'trunk-1',
            channel_id: `PJSIP/trunk-${callId}`,
            member_status: 'ALERT',
            call_path: '',
          },
        },
      ],
    },
  };
}

export function cdr(
  callId: string,
  input: {
    from: string;
    to: string;
    type: 'Inbound' | 'Outbound' | 'Internal';
    status: 'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'VOICEMAIL' | 'ABANDONED';
    talk?: number;
    total?: number;
    recording?: string;
    timeStart?: string;
    uid?: string;
  },
) {
  const total = input.total ?? (input.talk ?? 0) + 8;
  return {
    type: 30012,
    sn: 'FAKE0001',
    msg: {
      call_id: callId,
      time_start: input.timeStart ?? pbxNow(),
      call_from: input.from,
      call_to: input.to,
      call_duration: total,
      talk_duration: input.talk ?? 0,
      src_trunk_name: input.type === 'Inbound' ? 'trunk-1' : '',
      dst_trunk_name: input.type === 'Outbound' ? 'trunk-1' : '',
      pin_code: '',
      status: input.status,
      type: input.type,
      recording: input.recording ?? '',
      did_number: input.type === 'Inbound' ? input.to : '',
      did_name: '',
      agent_ring_time: 0,
      uid: input.uid ?? `uid-${callId}`,
      call_note_id: '',
      enb_call_note: 0,
      is_display: 1,
    },
  };
}

/**
 * The same call as `GET /cdr/search` returns it, which is not the shape the 30012 event uses.
 *
 * Worth the duplication: serving the event shape from this endpoint is what made a reconciler that
 * imported nothing look like a reconciler with nothing to import.
 */
export function cdrRow(
  callId: string,
  input: {
    from: string;
    to: string;
    type: 'Inbound' | 'Outbound' | 'Internal';
    status: 'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'VOICEMAIL' | 'ABANDONED';
    talk?: number;
    total?: number;
    recording?: string;
    at?: Date;
    uid?: string;
  },
) {
  const at = input.at ?? new Date();
  const talk = input.talk ?? 0;
  return {
    // MM/DD/YYYY, as the PBX writes it, and deliberately not what the parser reads.
    time: `${String(at.getUTCMonth() + 1).padStart(2, '0')}/${String(at.getUTCDate()).padStart(2, '0')}/${at.getUTCFullYear()}`,
    timestamp: Math.floor(at.getTime() / 1000),
    call_from: input.from,
    call_to: input.to,
    duration: input.total ?? talk + 8,
    talk_duration: talk,
    ring_duration: 0,
    disposition: input.status,
    call_type: input.type,
    call_id: callId,
    uid: input.uid ?? `uid-${callId}`,
    src_trunk: input.type === 'Inbound' ? 'trunk-1' : '',
    dst_trunk: input.type === 'Outbound' ? 'trunk-1' : '',
    recording: input.recording ?? '',
    did: input.type === 'Inbound' ? input.to : '',
    did_name: '',
    pin_code: '',
    call_note_id: '',
    enb_call_note: 0,
  };
}

/** "YYYY-MM-DD HH:mm:ss" in the PBX zone used by tests (Africa/Nairobi, UTC+3). */
export function pbxNow(offsetSec = 0): string {
  const d = new Date(Date.now() + offsetSec * 1000 + 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
