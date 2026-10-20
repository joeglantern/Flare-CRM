/**
 * Which addresses may use the CRM, when an admin has locked it to a list (Settings, Security).
 *
 * An entry is one address (102.205.237.244, 2001:db8::1) or a range in CIDR form
 * (41.90.0.0/16). Matching uses Node's own BlockList, so IPv4 and IPv6 are both handled the way
 * the network stack handles them, including an IPv4 address that arrives written as IPv6
 * (::ffff:102.205.237.244).
 */
import { BlockList, isIP } from 'node:net';

export interface AllowEntry {
  value: string;
  label?: string | undefined;
}

/** The address as the comparison wants it: no IPv4-in-IPv6 wrapper, no zone, no brackets. */
export function normalizeIp(ip: string): string {
  const bare = ip
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  return mapped?.[1] ?? bare;
}

/** Null when the text is a valid address or range, else what is wrong with it. */
export function entryProblem(value: string): string | null {
  const [address = '', prefix, extra] = value.trim().split('/');
  if (extra !== undefined) return 'Use one address, or one range such as 41.90.0.0/16';
  const family = isIP(normalizeIp(address));
  if (family === 0) return 'Not an IP address';
  if (prefix === undefined) return null;
  const bits = Number(prefix);
  const max = family === 4 ? 32 : 128;
  if (!/^\d+$/.test(prefix) || bits < 0 || bits > max)
    return `The range must end in /0 to /${String(max)}`;
  return null;
}

const cache = new Map<string, BlockList>();

function listFor(entries: AllowEntry[]): BlockList {
  const key = entries.map((e) => e.value.trim()).join(',');
  const hit = cache.get(key);
  if (hit) return hit;
  const list = new BlockList();
  for (const e of entries) {
    if (entryProblem(e.value) !== null) continue;
    const [raw = '', prefix] = e.value.trim().split('/');
    const address = normalizeIp(raw);
    const type = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
  }
  if (cache.size > 20) cache.clear();
  cache.set(key, list);
  return list;
}

export function ipAllowed(entries: AllowEntry[], ip: string | null | undefined): boolean {
  if (!ip) return false;
  const address = normalizeIp(ip);
  const family = isIP(address);
  if (family === 0) return false;
  return listFor(entries).check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * The client's address for a request that did not come through Fastify's own parsing (the
 * Socket.IO handshake), read the same way Fastify reads it: trust `hops` proxies in front of the
 * server, so the client is that many entries from the right of X-Forwarded-For.
 */
export function clientIpFrom(
  forwardedFor: string | string[] | undefined,
  remote: string | undefined,
  hops: number,
): string | null {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? '');
  const chain = [
    ...header
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(remote ? [remote] : []),
  ];
  if (chain.length === 0) return null;
  return chain[Math.max(0, chain.length - 1 - hops)] ?? null;
}
