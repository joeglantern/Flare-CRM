/**
 * What the console promises an owner, and what it promises a customer stack.
 *
 * The interop check matters most: the document this service signs is verified here with the
 * customer stack's own verifier, imported across the app boundary on purpose. If the two ever
 * stop agreeing on what a valid document is, this test fails rather than a customer's CRM.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { LINK_PROTOCOL, normaliseFeatures, signedEnvelope } from '@crm/shared';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parsePublicKey, verifyEnvelope } from '../../../api/src/modules/entitlements/signature.js';
import { TestContext, TEST_SIGNING_KEY, type TestOwner } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

/** The public half of the run's signing key, exactly as a stack would be handed it. */
const TRUSTED = parsePublicKey(
  createPublicKey(
    createPrivateKey({
      key: Buffer.from(TEST_SIGNING_KEY, 'base64'),
      format: 'der',
      type: 'pkcs8',
    }),
  )
    .export({ type: 'spki', format: 'der' })
    .toString('base64'),
);

let ctx: TestContext;
let owner: TestOwner;
let port = 0;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  // A real listening socket: the link is websockets, and inject cannot speak them.
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const address = ctx.app.server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
});

beforeEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await ctx.reset();
  owner = await ctx.createOwner();
});

afterAll(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await ctx.close();
});

async function newCustomer(slug = 'acme'): Promise<{ id: string; primaryDomain: string }> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: '/api/v1/customers',
    payload: { name: 'Acme Ltd', slug, contactName: 'Jane Doe', contactEmail: 'jane@acme.example' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Envelope<{ id: string; primaryDomain: string }>>().data;
}

async function newStack(
  customerId: string,
): Promise<{ stackId: string; secret: string; envLines: string[] }> {
  const res = await ctx.as(owner, {
    method: 'POST',
    url: `/api/v1/customers/${customerId}/stacks`,
    payload: {},
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Envelope<{ stackId: string; secret: string; envLines: string[] }>>().data;
}

async function issueTo(
  customerId: string,
): Promise<{ id: string; stackId: string; status: string }[]> {
  const res = await ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${customerId}/issue` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Envelope<{ issues: { id: string; stackId: string; status: string }[] }>>().data
    .issues;
}

/** Resolves with the next payload for an event, or rejects rather than hanging the run. */
function next<T>(socket: ClientSocket, event: string, ms = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event);
      reject(new Error(`timed out waiting for ${event}`));
    }, ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function connect(namespace: string, options: Record<string, unknown>): ClientSocket {
  const socket = ioClient(`http://127.0.0.1:${String(port)}${namespace}`, {
    transports: ['websocket'],
    reconnection: false,
    // Without this the client reuses the connection an earlier socket opened to the same origin,
    // and the handshake carries that socket's credentials instead of these ones.
    forceNew: true,
    ...options,
  });
  clients.push(socket);
  return socket;
}

/** Waits for a handshake, reporting why it was refused rather than only that it did not happen. */
function connected(socket: ClientSocket, ms = 15_000): Promise<ClientSocket> {
  return new Promise<ClientSocket>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('the handshake neither succeeded nor failed'));
    }, ms);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`handshake refused: ${err.message}`));
    });
  });
}

async function connectStack(stackId: string, secret: string): Promise<ClientSocket> {
  return connected(connect('/link', { auth: { stackId, secret, protocol: LINK_PROTOCOL } }));
}

async function connectOwner(): Promise<ClientSocket> {
  return connected(connect('/', { extraHeaders: { cookie: owner.cookie } }));
}

function hello(stackId: string) {
  return {
    stackId,
    protocol: LINK_PROTOCOL,
    version: 'abc1234',
    domain: 'acme.flare.test',
    startedAt: new Date().toISOString(),
    entitlements: { issueId: null, issuedAt: null, keyId: null },
  };
}

function heartbeat() {
  return {
    at: new Date().toISOString(),
    version: 'abc1234',
    ready: { ok: true, checks: { db: { ok: true } } },
    usage: {
      seatsActive: 4,
      storageBytes: 1024,
      attachmentsBytes: 1000,
      recordingsBytes: 24,
      backupsBytes: 0,
    },
    lastBackupAt: new Date().toISOString(),
    entitlements: { issueId: null, issuedAt: null, keyId: null },
  };
}

/** Read helpers for the polls that wait on a socket handler finishing its write. */
async function stackRow(stackId: string) {
  return ctx.app.db.stack.findUniqueOrThrow({ where: { id: stackId } });
}

async function issueRow(issueId: string) {
  return ctx.app.db.entitlementIssue.findUniqueOrThrow({ where: { id: issueId } });
}

describe('console: customers, plans and what they are entitled to', () => {
  it('refuses everything until two-factor is set up', async () => {
    const bare = await ctx.createOwner({ enrol: false, email: 'bare@example.com' });
    const res = await ctx.as(bare, { method: 'GET', url: '/api/v1/customers' });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('TWO_FACTOR_REQUIRED');
    expect((await ctx.as(owner, { method: 'GET', url: '/api/v1/customers' })).statusCode).toBe(200);
    expect((await ctx.as(null, { method: 'GET', url: '/api/v1/customers' })).statusCode).toBe(401);
  });

  it('gives a new customer their subdomain and the default plan', async () => {
    const customer = await newCustomer();
    expect(customer.primaryDomain).toBe('acme.flare.test');
    const res = await ctx.as(owner, {
      method: 'GET',
      url: `/api/v1/customers/${customer.id}/entitlements`,
    });
    const effective = res.json<
      Envelope<{
        effective: { plan: { name: string } | null; features: Record<string, boolean> };
      }>
    >().data.effective;
    expect(effective.plan?.name).toBe('Standard');
    // the seeded plan withholds these two
    expect(effective.features.softphone).toBe(false);
    expect(effective.features.api_docs).toBe(false);
    expect(effective.features.telephony).toBe(true);
  });

  it('refuses a slug that is already taken', async () => {
    await newCustomer('acme');
    const again = await ctx.as(owner, {
      method: 'POST',
      url: '/api/v1/customers',
      payload: {
        name: 'Acme Two',
        slug: 'acme',
        contactName: 'Someone',
        contactEmail: 'someone@example.com',
      },
    });
    expect(again.statusCode).toBe(409);
  });

  it('layers overrides on the plan and keeps the result coherent', async () => {
    const customer = await newCustomer();
    // Turning telephony off has to take recordings with it, though nobody asked for that.
    const saved = await ctx.as(owner, {
      method: 'PUT',
      url: `/api/v1/customers/${customer.id}/entitlements`,
      payload: { featureOverrides: { telephony: false }, limitOverrides: { seats: 3 } },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const res = await ctx.as(owner, {
      method: 'GET',
      url: `/api/v1/customers/${customer.id}/entitlements`,
    });
    const effective = res.json<
      Envelope<{
        effective: { features: Record<string, boolean>; limits: Record<string, number | null> };
      }>
    >().data.effective;
    expect(effective.features.telephony).toBe(false);
    expect(effective.features.recordings).toBe(false);
    expect(effective.limits.seats).toBe(3);
    // an untouched limit still comes from the plan
    expect(effective.limits.storage_gb).toBe(20);
  });

  it('issues a document the customer stack accepts, addressed to that stack', async () => {
    const customer = await newCustomer();
    const stack = await newStack(customer.id);
    expect(stack.stackId).toMatch(/^stk_[a-z2-7]{20}$/);
    expect(stack.envLines).toHaveLength(4);
    expect(stack.envLines.some((line) => line.startsWith('CONSOLE_PUBLIC_KEY='))).toBe(true);

    const issues = await issueTo(customer.id);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.stackId).toBe(stack.stackId);

    const row = await issueRow(issues[0]?.id ?? '');
    const verified = verifyEnvelope(signedEnvelope.parse(row.envelope), [TRUSTED]);
    expect(verified.ok ? 'ok' : verified.reason).toBe('ok');
    if (!verified.ok) return;
    expect(verified.document.audience).toBe(stack.stackId);
    expect(verified.document.customerId).toBe(customer.id);
    expect(verified.document.customerName).toBe('Acme Ltd');
    expect(verified.document.features).toEqual(normaliseFeatures(verified.document.features));
    expect(verified.document.ownerContact.email).toBe('support@example.com');
  });

  it('signs a document that cannot be edited afterwards', async () => {
    const customer = await newCustomer();
    await newStack(customer.id);
    const issues = await issueTo(customer.id);
    const envelope = signedEnvelope.parse((await issueRow(issues[0]?.id ?? '')).envelope);
    const document = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')) as {
      features: Record<string, boolean>;
    };
    document.features.api_docs = true;
    const tampered = {
      ...envelope,
      payload: Buffer.from(JSON.stringify(document), 'utf8').toString('base64url'),
    };
    expect(verifyEnvelope(tampered, [TRUSTED]).ok).toBe(false);
  });

  it('supersedes an outstanding document rather than leaving two in flight', async () => {
    const customer = await newCustomer();
    await newStack(customer.id);
    const first = await issueTo(customer.id);
    await issueTo(customer.id);
    expect((await issueRow(first[0]?.id ?? '')).status).toBe('superseded');
    expect(
      await ctx.app.db.entitlementIssue.count({
        where: { customerId: customer.id, status: 'pending' },
      }),
    ).toBe(1);
  });

  it('will not issue to a customer with no stack yet', async () => {
    const customer = await newCustomer();
    const res = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customer.id}/issue`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('stores only a hash of a stack secret, and can still check it', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    expect((await stackRow(stackId)).secretHash).not.toContain(secret);
    expect(await ctx.app.stacks.authenticate(stackId, secret)).toMatchObject({ id: stackId });
    expect(await ctx.app.stacks.authenticate(stackId, 'wrong')).toBeNull();

    // rotating hands out a new secret without changing the id
    const rotated = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/stacks/${stackId}/rotate`,
    });
    const replacement = rotated.json<Envelope<{ stackId: string; secret: string }>>().data;
    expect(replacement.stackId).toBe(stackId);
    expect(await ctx.app.stacks.authenticate(stackId, secret)).toBeNull();
    expect(await ctx.app.stacks.authenticate(stackId, replacement.secret)).toMatchObject({
      id: stackId,
    });

    const revoked = await ctx.as(owner, { method: 'DELETE', url: `/api/v1/stacks/${stackId}` });
    expect(revoked.statusCode).toBe(204);
    expect(await ctx.app.stacks.authenticate(stackId, replacement.secret)).toBeNull();
  });

  it('will not delete a plan somebody is on', async () => {
    await newCustomer();
    const plans = await ctx.as(owner, { method: 'GET', url: '/api/v1/plans' });
    const standard = plans.json<Envelope<{ id: string; name: string }[]>>().data[0];
    const res = await ctx.as(owner, {
      method: 'DELETE',
      url: `/api/v1/plans/${standard?.id ?? ''}`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('records every change against the owner who made it, and cannot rewrite it after', async () => {
    const customer = await newCustomer();
    await ctx.as(owner, {
      method: 'PUT',
      url: `/api/v1/customers/${customer.id}/entitlements`,
      payload: { featureOverrides: { exports: false } },
    });
    const audit = await ctx.as(owner, { method: 'GET', url: '/api/v1/audit' });
    const rows =
      audit.json<Envelope<{ action: string; actorId: string | null; actorName: string | null }[]>>()
        .data;
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['customer.create', 'entitlement.update']),
    );
    expect(rows.every((r) => r.actorId === owner.id && r.actorName === 'Test Owner')).toBe(true);

    const one = await ctx.app.db.auditLog.findFirstOrThrow();
    await expect(ctx.app.db.auditLog.delete({ where: { id: one.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('never writes a stack secret into the audit log', async () => {
    const customer = await newCustomer();
    const { secret } = await newStack(customer.id);
    const rows = await ctx.app.db.auditLog.findMany();
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it('verifies a customer domain only when both records are in place', async () => {
    const customer = await newCustomer();
    const set = await ctx.as(owner, {
      method: 'PUT',
      url: `/api/v1/customers/${customer.id}/domain`,
      payload: { customDomain: 'crm.acme.example' },
    });
    const records = set.json<Envelope<{ txtValue: string; cnameTarget: string }>>().data;
    expect(records.cnameTarget).toBe('acme.flare.test');

    ctx.app.dnsResolver.resolveCname = () => Promise.resolve([]);
    ctx.app.dnsResolver.resolveTxt = () => Promise.resolve([]);
    ctx.app.dnsResolver.resolve4 = () => Promise.resolve(['203.0.113.10']);
    const verify = () =>
      ctx.as(owner, { method: 'POST', url: `/api/v1/customers/${customer.id}/domain/verify` });

    const before = await verify();
    expect(before.json<Envelope<{ verified: boolean }>>().data.verified).toBe(false);

    // The CNAME alone proves nothing: anyone may point a name at us.
    ctx.app.dnsResolver.resolveCname = () => Promise.resolve(['acme.flare.test']);
    expect((await verify()).json<Envelope<{ verified: boolean }>>().data.verified).toBe(false);

    ctx.app.dnsResolver.resolveTxt = () => Promise.resolve([[records.txtValue]]);
    const done = await verify();
    const result = done.json<Envelope<{ verified: boolean; cname: { ok: boolean } }>>().data;
    expect(result.verified).toBe(true);
    expect(result.cname.ok).toBe(true);
    expect(
      (await ctx.app.db.customer.findUniqueOrThrow({ where: { id: customer.id } }))
        .customDomainVerifiedAt,
    ).not.toBeNull();
  });
});

describe('console: the link a customer stack dials home on', () => {
  it('turns away a stack with the wrong credentials, over REST and over the socket', async () => {
    const customer = await newCustomer();
    const { stackId } = await newStack(customer.id);

    const noHeader = await ctx.app.inject({ method: 'GET', url: '/api/link/entitlements' });
    expect(noHeader.statusCode).toBe(401);
    const wrongSecret = await ctx.app.inject({
      method: 'GET',
      url: '/api/link/entitlements',
      headers: { authorization: `Bearer ${stackId}.not-the-secret` },
    });
    expect(wrongSecret.statusCode).toBe(401);

    const socket = connect('/link', {
      auth: { stackId, secret: 'not-the-secret', protocol: LINK_PROTOCOL },
    });
    expect((await next<Error>(socket, 'connect_error')).message).toBe('UNAUTHENTICATED');
  });

  it('refuses a protocol it does not speak', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const socket = connect('/link', { auth: { stackId, secret, protocol: 99 } });
    expect((await next<Error>(socket, 'connect_error')).message).toBe('UNSUPPORTED_PROTOCOL');
  });

  it('marks a stack live on hello and reports it to a watching owner', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const watcher = await connectOwner();
    const stack = await connectStack(stackId, secret);

    const seen = next<{ stackId: string; connected: boolean; version: string | null }>(
      watcher,
      'fleet:stack',
    );
    stack.emit('hello', hello(stackId));
    expect(await seen).toMatchObject({ stackId, connected: true, version: 'abc1234' });

    const row = await stackRow(stackId);
    expect(row.connected).toBe(true);
    expect(row.domain).toBe('acme.flare.test');
    expect(ctx.app.link.connectedStacks()).toContain(stackId);
  });

  it('keeps a heartbeat, and the fleet screen reads seats and storage from it', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const watcher = await connectOwner();
    const stack = await connectStack(stackId, secret);
    stack.emit('hello', hello(stackId));
    await next(watcher, 'fleet:stack');

    const beat = next<{ usage: { seatsActive: number } | null; readyOk: boolean | null }>(
      watcher,
      'fleet:stack',
    );
    stack.emit('heartbeat', heartbeat());
    const event = await beat;
    expect(event.usage?.seatsActive).toBe(4);
    expect(event.readyOk).toBe(true);

    const fleet = await ctx.as(owner, { method: 'GET', url: '/api/v1/fleet' });
    const row = fleet.json<
      Envelope<
        {
          connected: boolean;
          seats: { used: number | null; max: number | null };
          storageBytes: number | null;
          version: string | null;
        }[]
      >
    >().data[0];
    expect(row?.connected).toBe(true);
    expect(row?.seats).toEqual({ used: 4, max: 10 });
    expect(row?.storageBytes).toBe(1024);
    expect(row?.version).toBe('abc1234');
  });

  it('hands a waiting document to a stack that says hello, and follows its answer', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const issueId = (await issueTo(customer.id))[0]?.id ?? '';

    const watcher = await connectOwner();
    const stack = await connectStack(stackId, secret);
    const handed = next<{ issueId: string; envelope: unknown }>(stack, 'entitlements');
    stack.emit('hello', hello(stackId));
    const push = await handed;
    expect(push.issueId).toBe(issueId);

    // What the stack does next: verify, apply, say so.
    expect(verifyEnvelope(signedEnvelope.parse(push.envelope), [TRUSTED]).ok).toBe(true);
    await expect.poll(async () => (await issueRow(issueId)).status).toBe('delivered');

    stack.emit('ack', { issueId, appliedAt: new Date().toISOString(), result: 'applied' });
    let status = await next<{ issueId: string; status: string }>(watcher, 'issue:status', 8000);
    while (status.status !== 'acked') {
      status = await next<{ issueId: string; status: string }>(watcher, 'issue:status', 8000);
    }
    expect(status.issueId).toBe(issueId);

    const row = await issueRow(issueId);
    expect(row.status).toBe('acked');
    expect(row.ackedAt).not.toBeNull();
    expect((await stackRow(stackId)).currentIssueId).toBe(issueId);
  });

  it('records a document the stack refused, with its reason', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const issueId = (await issueTo(customer.id))[0]?.id ?? '';
    const stack = await connectStack(stackId, secret);
    stack.emit('ack', {
      issueId,
      appliedAt: new Date().toISOString(),
      result: 'rejected',
      reason: 'signature does not match the payload',
    });
    await expect.poll(async () => (await issueRow(issueId)).status).toBe('rejected');
    expect((await issueRow(issueId)).rejectReason).toBe('signature does not match the payload');
    expect((await stackRow(stackId)).currentIssueId).toBeNull();
  });

  it('serves the same document over REST for a stack whose socket is not up yet', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const issueId = (await issueTo(customer.id))[0]?.id ?? '';
    const bearer = `Bearer ${stackId}.${secret}`;

    const caught = await ctx.app.inject({
      method: 'GET',
      url: '/api/link/entitlements',
      headers: { authorization: bearer },
    });
    expect(caught.statusCode, caught.body).toBe(200);
    expect(caught.json<{ issueId: string }>().issueId).toBe(issueId);
    expect((await issueRow(issueId)).status).toBe('delivered');

    const acked = await ctx.app.inject({
      method: 'POST',
      url: '/api/link/ack',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      payload: { issueId, appliedAt: new Date().toISOString(), result: 'applied' },
    });
    expect(acked.statusCode, acked.body).toBe(200);
    expect((await issueRow(issueId)).status).toBe('acked');

    // Nothing outstanding once it is acked.
    const again = await ctx.app.inject({
      method: 'GET',
      url: '/api/link/entitlements',
      headers: { authorization: bearer },
    });
    expect(again.statusCode).toBe(204);
  });

  it('reaches a connected stack with an announcement, and refuses when none is connected', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const announcement = { message: 'Maintenance at 22:00', level: 'warning' };

    const offline = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customer.id}/announce`,
      payload: announcement,
    });
    expect(offline.statusCode).toBe(409);

    const watcher = await connectOwner();
    const stack = await connectStack(stackId, secret);
    stack.emit('hello', hello(stackId));
    await next(watcher, 'fleet:stack');

    const heard = next<{ message: string; level: string }>(stack, 'announce');
    const sent = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/customers/${customer.id}/announce`,
      payload: announcement,
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json<Envelope<{ delivered: number }>>().data.delivered).toBe(1);
    expect(await heard).toEqual(announcement);
  });

  it('drops the live connection when the secret is rotated', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const stack = await connectStack(stackId, secret);
    stack.emit('hello', hello(stackId));
    await expect.poll(async () => (await stackRow(stackId)).connected).toBe(true);

    const gone = next<string>(stack, 'disconnect');
    const rotated = await ctx.as(owner, {
      method: 'POST',
      url: `/api/v1/stacks/${stackId}/rotate`,
    });
    expect(rotated.statusCode).toBe(200);
    await gone;
    await expect.poll(async () => (await stackRow(stackId)).connected).toBe(false);

    // The old credential no longer opens a socket.
    const refused = connect('/link', { auth: { stackId, secret, protocol: LINK_PROTOCOL } });
    expect((await next<Error>(refused, 'connect_error')).message).toBe('UNAUTHENTICATED');
  });

  it('lets the newest connection for a stack win', async () => {
    const customer = await newCustomer();
    const { stackId, secret } = await newStack(customer.id);
    const first = await connectStack(stackId, secret);
    const dropped = next<string>(first, 'disconnect');
    const second = await connectStack(stackId, secret);
    await dropped;
    second.emit('hello', hello(stackId));
    await expect.poll(async () => (await stackRow(stackId)).connected).toBe(true);
    expect(ctx.app.link.connectedStacks()).toEqual([stackId]);
  });

  it('does not let a browser without two-factor watch the fleet', async () => {
    const bare = await ctx.createOwner({ enrol: false, email: 'bare-socket@example.com' });
    const socket = connect('/', { extraHeaders: { cookie: bare.cookie } });
    expect((await next<Error>(socket, 'connect_error')).message).toBe('UNAUTHENTICATED');
  });
});
