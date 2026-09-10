/**
 * One HTTP request at worker boot, before the socket is up (docs/21).
 *
 * A stack that was restarted while the console was briefly unreachable would otherwise sit on an
 * old document until the next time an owner issued one. This asks for whatever is waiting, applies
 * it, and says so.
 *
 * Deliberately short and deliberately quiet: if the console is down, the stack keeps running on the
 * document it already holds, which is the whole point of the document being signed and stored.
 */
import { linkEntitlementsResponse } from '@crm/shared';
import { request } from 'undici';
import {
  SYSTEM_AUDIT,
  type EntitlementsService,
} from '../../modules/entitlements/entitlements.service.js';

const TIMEOUT_MS = 10_000;

interface Logger {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}

export interface CatchUpDeps {
  entitlements: EntitlementsService;
  log: Logger;
  config: { CONSOLE_URL: string; CONSOLE_STACK_ID: string; CONSOLE_STACK_SECRET: string };
}

export type CatchUpOutcome =
  | { result: 'applied'; issueId: string }
  | { result: 'rejected'; issueId: string; reason: string }
  | { result: 'nothing-waiting' }
  | { result: 'unreachable'; reason: string };

export async function catchUp(deps: CatchUpDeps): Promise<CatchUpOutcome> {
  const { config, log } = deps;
  const authorization = `Bearer ${config.CONSOLE_STACK_ID}.${config.CONSOLE_STACK_SECRET}`;
  let body: unknown;
  try {
    const response = await request(`${config.CONSOLE_URL}/api/link/entitlements`, {
      method: 'GET',
      headers: { authorization, accept: 'application/json' },
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });
    if (response.statusCode === 204) {
      await response.body.dump();
      return { result: 'nothing-waiting' };
    }
    if (response.statusCode !== 200) {
      await response.body.dump();
      return { result: 'unreachable', reason: `console answered ${String(response.statusCode)}` };
    }
    body = await response.body.json();
  } catch (err) {
    return { result: 'unreachable', reason: err instanceof Error ? err.message : String(err) };
  }

  const parsed = linkEntitlementsResponse.safeParse(body);
  if (!parsed.success || parsed.data === null) {
    return { result: 'unreachable', reason: 'the console sent something unreadable' };
  }
  const { issueId, envelope } = parsed.data;
  const outcome = await deps.entitlements.apply(envelope, {
    issueId,
    source: 'console',
    ctx: SYSTEM_AUDIT,
  });
  await acknowledge(deps, authorization, issueId, outcome);
  if (outcome.result === 'applied') {
    log.info({ issueId, plan: outcome.state.doc.plan.name }, 'caught up with the console');
    return { result: 'applied', issueId };
  }
  log.warn({ issueId, reason: outcome.reason }, 'the waiting document was refused');
  return { result: 'rejected', issueId, reason: outcome.reason };
}

async function acknowledge(
  deps: CatchUpDeps,
  authorization: string,
  issueId: string,
  outcome: { result: 'applied' } | { result: 'rejected'; reason: string },
): Promise<void> {
  try {
    const response = await request(`${deps.config.CONSOLE_URL}/api/link/ack`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
      body: JSON.stringify({
        issueId,
        appliedAt: new Date().toISOString(),
        result: outcome.result,
        ...(outcome.result === 'rejected' ? { reason: outcome.reason } : {}),
      }),
    });
    await response.body.dump();
  } catch (err) {
    // The document is applied either way; the console will see the next heartbeat carrying it.
    deps.log.warn({ err, issueId }, 'could not acknowledge to the console');
  }
}
