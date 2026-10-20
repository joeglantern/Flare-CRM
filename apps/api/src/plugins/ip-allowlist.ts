/**
 * The address lock (Settings, Security): with it on, the CRM answers only the addresses on the
 * admin's list.
 *
 * Checked before anything else on every request, sign-in included, so a stolen password is of no
 * use from anywhere else. Left open: health checks, and routes marked public, which are the PBX
 * and WhatsApp webhooks and the public web forms, since those never come from the office. The
 * live connection is checked in the socket handshake (plugins/socket.ts) with the same list.
 *
 * Every refusal is in the audit log, once per address every ten minutes so a script hammering the
 * door cannot flood it. IP_ALLOWLIST_DISABLED on the server is the way back in for an admin who
 * locked everyone out.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { IpNotAllowedError } from '../lib/errors.js';
import { ipAllowed, normalizeIp } from '../lib/ip-allowlist.js';
import { AuditService } from '../modules/audit/audit.service.js';

const OPEN_PATHS = ['/health', '/ready', '/metrics'];

declare module 'fastify' {
  interface FastifyInstance {
    /** Whether this address may use the CRM right now; true whenever the lock is off. */
    addressAllowed: (ip: string | null | undefined) => Promise<boolean>;
    /** Records a refused address, at most once per address every ten minutes. */
    recordRefusal: (ip: string | null, where: string, userAgent: string | null) => Promise<void>;
  }
}

export default fp(
  function ipAllowlistPlugin(app: FastifyInstance) {
    const audit = new AuditService(app.db);

    app.decorate('addressAllowed', async (ip: string | null | undefined) => {
      if (app.config.IP_ALLOWLIST_DISABLED) return true;
      const lock = await app.settings.get('ipAllowlist');
      if (!lock.enabled) return true;
      return ipAllowed(lock.entries, ip);
    });

    app.decorate(
      'recordRefusal',
      async (ip: string | null, where: string, userAgent: string | null) => {
        const first = await app.valkey
          .set(`ip-lock:refused:${ip ?? 'unknown'}`, '1', 'EX', 600, 'NX')
          .catch(() => null);
        if (first !== 'OK') return;
        app.log.warn({ ip, where }, 'request refused by the address lock');
        await audit
          .write(
            { actorId: null, actorType: 'system', ip, userAgent },
            { action: 'security.ip_refused', entity: 'system', after: { ip, where } },
          )
          .catch(() => undefined);
      },
    );

    app.addHook('onRequest', async (request) => {
      const path = request.url.split('?')[0] ?? '';
      if (OPEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return;
      const auth = (request.routeOptions.config as { auth?: { public?: boolean } } | undefined)
        ?.auth;
      // Public routes need no session, but sign-in is one of them and is exactly what the lock is
      // for; the rest (webhooks, web forms) are called from outside the office by design.
      if (auth?.public === true && !path.startsWith('/api/auth/')) return;
      if (await app.addressAllowed(request.ip)) return;
      const ip = normalizeIp(request.ip);
      await app.recordRefusal(ip, path, request.headers['user-agent'] ?? null);
      throw new IpNotAllowedError(ip);
    });
  },
  { name: 'ip-allowlist', dependencies: ['config', 'services', 'valkey', 'prisma'] },
);
