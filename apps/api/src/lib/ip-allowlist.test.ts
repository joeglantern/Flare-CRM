import { describe, expect, it } from 'vitest';
import { clientIpFrom, entryProblem, ipAllowed, normalizeIp } from './ip-allowlist.js';

describe('the CRM address lock', () => {
  const entries = [
    { value: '102.205.237.244', label: 'Office' },
    { value: '41.90.0.0/16' },
    { value: '2001:db8::/32' },
  ];

  it('lets in a listed address, an address in a listed range, and nothing else', () => {
    expect(ipAllowed(entries, '102.205.237.244')).toBe(true);
    expect(ipAllowed(entries, '41.90.12.3')).toBe(true);
    expect(ipAllowed(entries, '2001:db8:1::5')).toBe(true);
    expect(ipAllowed(entries, '102.205.237.245')).toBe(false);
    expect(ipAllowed(entries, '41.91.0.1')).toBe(false);
    expect(ipAllowed(entries, null)).toBe(false);
    expect(ipAllowed([], '102.205.237.244')).toBe(false);
  });

  it('treats an IPv4 address written as IPv6 as the IPv4 address', () => {
    expect(normalizeIp('::ffff:102.205.237.244')).toBe('102.205.237.244');
    expect(ipAllowed(entries, '::ffff:102.205.237.244')).toBe(true);
  });

  it('says what is wrong with an entry', () => {
    expect(entryProblem('102.205.237.244')).toBeNull();
    expect(entryProblem('41.90.0.0/16')).toBeNull();
    expect(entryProblem('crm.example.com')).toMatch(/Not an IP/);
    expect(entryProblem('41.90.0.0/33')).toMatch(/\/32/);
    expect(entryProblem('1.2.3.4/8/9')).toMatch(/one range/);
  });

  it('reads the client the way Fastify does behind one proxy', () => {
    expect(clientIpFrom('102.205.237.244', '172.18.0.5', 1)).toBe('102.205.237.244');
    expect(clientIpFrom('6.6.6.6, 102.205.237.244', '172.18.0.5', 1)).toBe('102.205.237.244');
    expect(clientIpFrom(undefined, '10.0.0.9', 0)).toBe('10.0.0.9');
  });
});
