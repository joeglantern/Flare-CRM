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
    app.get('/openapi/v1.0/call/query', async () => ({ errcode: 0, errmsg: 'SUCCESS', data: [] }));
    app.get('/openapi/v1.0/cdr/search', async (request) => {
      if (!authed(request)) return { errcode: 10004, errmsg: 'Invalid token' };
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
    app.get('/openapi/v1.0/extension/list', async () => ({
      errcode: 0,
      errmsg: 'SUCCESS',
      data: [{ number: '1001' }, { number: '1002' }],
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

  /** Push an event to every subscribed CRM socket. */
  emit(event: unknown): void {
    const text = JSON.stringify(event);
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

/** "YYYY-MM-DD HH:mm:ss" in the PBX zone used by tests (Africa/Nairobi, UTC+3). */
export function pbxNow(offsetSec = 0): string {
  const d = new Date(Date.now() + offsetSec * 1000 + 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
