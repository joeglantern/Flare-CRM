/**
 * Reading `/ready`, which is not like reading any other endpoint here.
 *
 * Three things make it different. It answers 503 when it is not ready, and that 503 is the answer
 * rather than a failure to get one. It is not under `/api/v1` and does not wrap its body in
 * `{ data }`, so the usual client would unwrap nothing. And a console that cannot be reached at all
 * is, for this purpose, a console that is not ready: the honest thing to render is a verdict, not a
 * "something went wrong" panel over a working page.
 *
 * So this never throws. Every outcome, including a dead socket and a body that is not JSON, comes
 * back as a Readiness with `reachable` saying which kind of answer it is.
 */

export interface ReadinessCheck {
  ok: boolean;
  /** Arbitrary and per check, so it is rendered generically rather than by name. */
  detail?: Record<string, unknown>;
  /** Present instead of `detail` when the check threw or timed out. */
  error?: string;
}

export interface Readiness {
  /** "ready" or "degraded" today, but it is a string on the wire and treated as one. */
  status: string;
  ok: boolean;
  /**
   * Null when the server answered but withheld the detail. `/ready` only itemises its checks for a
   * caller on the machine itself, so a browser reaching the console over a real hostname gets the
   * verdict and nothing under it. That is a deliberate answer, not an empty one.
   */
  checks: Record<string, ReadinessCheck> | null;
  reachable: boolean;
  readAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Believes only what the body actually contains, since this one is parsed by hand. */
function parse(body: unknown, httpOk: boolean): Omit<Readiness, 'readAt' | 'reachable'> {
  if (!isRecord(body)) return { status: 'unreadable', ok: false, checks: null };

  const status = typeof body.status === 'string' ? body.status : httpOk ? 'ready' : 'degraded';
  const ok = typeof body.ok === 'boolean' ? body.ok : httpOk;

  if (!isRecord(body.checks)) return { status, ok, checks: null };

  const checks: Record<string, ReadinessCheck> = {};
  for (const [name, raw] of Object.entries(body.checks)) {
    if (!isRecord(raw)) continue;
    checks[name] = {
      ok: raw.ok === true,
      ...(isRecord(raw.detail) ? { detail: raw.detail } : {}),
      ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    };
  }
  return { status, ok, checks };
}

export async function readReadiness(): Promise<Readiness> {
  const readAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetch('/ready', { headers: { Accept: 'application/json' } });
  } catch {
    return { status: 'unreachable', ok: false, checks: null, reachable: false, readAt };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A proxy error page, or an empty 502. The console did not answer for itself.
    return { status: 'unreadable', ok: false, checks: null, reachable: false, readAt };
  }

  return { ...parse(body, response.ok), reachable: true, readAt };
}

/** "connectedStacks" to "Connected stacks", so an unknown detail key still reads as English. */
export function humanise(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return spaced === '' ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Detail values are arbitrary, so anything that is not a primitive is shown as its JSON. */
export function showValue(value: unknown): string {
  if (value === null) return 'none';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
