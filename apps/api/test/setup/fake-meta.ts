/**
 * Minimal WhatsApp Cloud API (Meta Graph) look-alike for tests: message send, media upload,
 * media metadata + download. Records every request.
 */
import Fastify, { type FastifyInstance } from 'fastify';

export class FakeMeta {
  readonly requests: { method: string; path: string; body: unknown; auth: string | undefined }[] =
    [];
  readonly mediaBytes = Buffer.from('\x89PNG\r\n\x1a\nfake-png');
  failNextSend: { status: number; code: number; message: string } | null = null;
  private app: FastifyInstance | null = null;
  url = '';
  private seq = 0;

  async start(): Promise<string> {
    const app = Fastify({ logger: false });
    this.app = app;
    app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, { multipart: true, size: body.length });
    });
    app.addHook('preHandler', (request, _reply, done) => {
      this.requests.push({
        method: request.method,
        path: request.url.split('?')[0] ?? '',
        body: request.body,
        auth: request.headers.authorization,
      });
      done();
    });
    app.post('/:version/:phoneId/messages', async (_request, reply) => {
      if (this.failNextSend) {
        const f = this.failNextSend;
        this.failNextSend = null;
        return reply.status(f.status).send({ error: { code: f.code, message: f.message } });
      }
      this.seq++;
      return { messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${String(this.seq)}` }] };
    });
    app.post('/:version/:phoneId/media', async () => ({ id: `media-${String(++this.seq)}` }));
    app.get('/:version/:mediaId', async (request) => ({
      url: `${this.url}/download/${(request.params as { mediaId: string }).mediaId}`,
      mime_type: 'image/png',
      file_size: this.mediaBytes.length,
    }));
    app.get('/download/:id', async (_request, reply) =>
      reply.header('content-type', 'image/png').send(this.mediaBytes),
    );
    this.url = await app.listen({ host: '127.0.0.1', port: 0 });
    return this.url;
  }

  requestsTo(suffix: string) {
    return this.requests.filter((r) => r.path.endsWith(suffix));
  }

  async stop(): Promise<void> {
    await this.app?.close();
  }
}

export function inboundText(
  phoneNumberId: string,
  from: string,
  body: string,
  id = `wamid.IN${String(Date.now())}${String(Math.random()).slice(2, 6)}`,
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '254700000000', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: 'Web Customer' }, wa_id: from }],
              messages: [
                {
                  from,
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function inboundImage(phoneNumberId: string, from: string, mediaId: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '254700000000', phone_number_id: phoneNumberId },
              messages: [
                {
                  from,
                  id: `wamid.IMG${mediaId}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'image',
                  image: { id: mediaId, mime_type: 'image/png', caption: 'photo' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function statusUpdate(
  phoneNumberId: string,
  wamid: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: phoneNumberId },
              statuses: [
                {
                  id: wamid,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: '254712000000',
                  ...(status === 'failed'
                    ? {
                        errors: [
                          {
                            code: 131026,
                            title: 'Undeliverable',
                            message: 'Message undeliverable',
                          },
                        ],
                      }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
