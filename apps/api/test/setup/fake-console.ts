/**
 * A stand-in for the owner console: the `/link` namespace and the two bearer endpoints, and nothing
 * else. It is the real Socket.IO server and the real HTTP server, so the stack's client is exercised
 * exactly as it will be in production; only the console's own logic is faked.
 *
 * The real console is tested in its own suite. What this proves is the other half of the contract:
 * that this stack says hello, heartbeats, applies what it is handed, and acknowledges it.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  LINK_PROTOCOL,
  type SignedEnvelope,
  type StackToConsolePayload,
  type SupportCommand,
  type SupportResult,
} from '@crm/shared';
import { Server as IoServer, type Socket } from 'socket.io';
import { TEST_STACK_ID, TEST_STACK_SECRET } from './signing.js';

export interface FakeConsole {
  /** Base URL, as CONSOLE_URL takes it. */
  url: string;
  hellos: StackToConsolePayload<'hello'>[];
  heartbeats: StackToConsolePayload<'heartbeat'>[];
  acks: StackToConsolePayload<'ack'>[];
  /** What the stack answered when the provider asked it to do something. */
  commandResults: SupportResult[];
  /** Requests made to the two bearer endpoints, with the credential presented. */
  restCalls: { method: string; path: string; authorization: string | undefined }[];
  connectedStacks: () => string[];
  /** Hands a document to a connected stack, the way an owner pressing Issue does. */
  push: (envelope: SignedEnvelope, issueId: string) => boolean;
  announce: (message: { message: string; level: 'info' | 'warning' | 'error' }) => boolean;
  /** Asks a connected stack to do one supported thing, the way a support action does. */
  command: (command: SupportCommand) => boolean;
  /** What the REST catch-up will hand out, or null for "nothing waiting". */
  setWaiting: (waiting: { issueId: string; envelope: SignedEnvelope } | null) => void;
  /** Forgets what it has been told, so one test's history cannot satisfy the next test's wait. */
  reset: () => void;
  waitFor: <E extends WaitableEvent>(
    event: E,
    predicate?: (payload: StackToConsolePayload<E>) => boolean,
    ms?: number,
  ) => Promise<StackToConsolePayload<E>>;
  close: () => Promise<void>;
}

type WaitableEvent = 'hello' | 'heartbeat' | 'ack' | 'commandResult';

export async function startFakeConsole(): Promise<FakeConsole> {
  const hellos: StackToConsolePayload<'hello'>[] = [];
  const heartbeats: StackToConsolePayload<'heartbeat'>[] = [];
  const acks: StackToConsolePayload<'ack'>[] = [];
  const commandResults: SupportResult[] = [];
  const restCalls: FakeConsole['restCalls'] = [];
  const listeners = new Set<(event: string, payload: unknown) => void>();
  let waiting: { issueId: string; envelope: SignedEnvelope } | null = null;

  const authorized = (header: string | undefined): boolean =>
    header === `Bearer ${TEST_STACK_ID}.${TEST_STACK_SECRET}`;

  const http = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    restCalls.push({
      method: req.method ?? 'GET',
      path,
      authorization: req.headers.authorization,
    });
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (!authorized(req.headers.authorization)) {
      send(401, { error: { code: 'UNAUTHENTICATED', message: 'no', requestId: 'test' } });
      return;
    }
    if (req.method === 'GET' && path === '/api/link/entitlements') {
      if (waiting === null) {
        send(204);
        return;
      }
      send(200, waiting);
      return;
    }
    if (req.method === 'POST' && path === '/api/link/ack') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          acks.push(
            JSON.parse(Buffer.concat(chunks).toString('utf8')) as StackToConsolePayload<'ack'>,
          );
          for (const l of listeners) l('ack', acks[acks.length - 1]);
        } catch {
          // a malformed body is a failure of the test, not something to model
        }
        send(200, { ok: true });
      });
      return;
    }
    send(404, { error: { code: 'NOT_FOUND', message: 'no', requestId: 'test' } });
  });

  const io = new IoServer(http, { path: '/socket.io', transports: ['websocket'] });
  const link = io.of('/link');
  const live = new Map<string, Socket>();

  link.use((socket, next) => {
    const auth = socket.handshake.auth as {
      stackId?: unknown;
      secret?: unknown;
      protocol?: unknown;
    };
    if (auth.protocol !== LINK_PROTOCOL) {
      next(new Error('UNSUPPORTED_PROTOCOL'));
      return;
    }
    if (auth.stackId !== TEST_STACK_ID || auth.secret !== TEST_STACK_SECRET) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    socket.data = { stackId: auth.stackId };
    next();
  });

  link.on('connection', (socket) => {
    const { stackId } = socket.data as { stackId: string };
    live.set(stackId, socket);
    socket.on('hello', (raw: unknown) => {
      hellos.push(raw as StackToConsolePayload<'hello'>);
      for (const l of listeners) l('hello', raw);
    });
    socket.on('heartbeat', (raw: unknown) => {
      heartbeats.push(raw as StackToConsolePayload<'heartbeat'>);
      for (const l of listeners) l('heartbeat', raw);
    });
    socket.on('ack', (raw: unknown) => {
      acks.push(raw as StackToConsolePayload<'ack'>);
      for (const l of listeners) l('ack', raw);
    });
    socket.on('commandResult', (raw: unknown) => {
      commandResults.push(raw as SupportResult);
      for (const l of listeners) l('commandResult', raw);
    });
    socket.on('disconnect', () => {
      if (live.get(stackId)?.id === socket.id) live.delete(stackId);
    });
  });

  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', resolve);
  });
  const { port } = http.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    hellos,
    heartbeats,
    acks,
    commandResults,
    restCalls,
    connectedStacks: () => [...live.keys()],
    push: (envelope, issueId) => {
      const socket = live.get(TEST_STACK_ID);
      if (!socket) return false;
      socket.emit('entitlements', { envelope, issueId });
      return true;
    },
    announce: (message) => {
      const socket = live.get(TEST_STACK_ID);
      if (!socket) return false;
      socket.emit('announce', message);
      return true;
    },
    command: (command) => {
      const socket = live.get(TEST_STACK_ID);
      if (!socket) return false;
      socket.emit('command', command);
      return true;
    },
    setWaiting: (next) => {
      waiting = next;
    },
    reset: () => {
      hellos.length = 0;
      heartbeats.length = 0;
      acks.length = 0;
      commandResults.length = 0;
      restCalls.length = 0;
      waiting = null;
    },
    waitFor: <E extends WaitableEvent>(
      event: E,
      predicate?: (payload: StackToConsolePayload<E>) => boolean,
      ms = 8000,
    ) =>
      new Promise<StackToConsolePayload<E>>((resolve, reject) => {
        const already = {
          hello: hellos,
          heartbeat: heartbeats,
          ack: acks,
          commandResult: commandResults,
        }[event] as StackToConsolePayload<E>[];
        const found = [...already].reverse().find((p) => predicate?.(p) ?? true);
        if (found !== undefined) {
          resolve(found);
          return;
        }
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error(`timed out waiting for ${event}`));
        }, ms);
        const listener = (name: string, payload: unknown) => {
          if (name !== event) return;
          const typed = payload as StackToConsolePayload<E>;
          if (predicate !== undefined && !predicate(typed)) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(typed);
        };
        listeners.add(listener);
      }),
    close: async () => {
      for (const socket of live.values()) socket.disconnect(true);
      await io.close();
      await new Promise<void>((resolve) => {
        http.close(() => {
          resolve();
        });
      });
    },
  };
}
