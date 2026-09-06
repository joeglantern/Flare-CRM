/**
 * Wires the Yeastar integration into the app (both processes): client, token manager, extension
 * map, state machine, capabilities. The worker additionally runs the WebSocket subscriber.
 */
import type { ServerEventPayload } from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { CallStateMachine } from '../integrations/yeastar/call-state.js';
import { YeastarClient } from '../integrations/yeastar/client.js';
import { ExtensionMap } from '../integrations/yeastar/extension-map.js';
import { readCtiStatus } from '../integrations/yeastar/subscriber.js';
import { TokenManager } from '../integrations/yeastar/token-manager.js';

export type CtiCapabilities = ServerEventPayload<'call:ringing'>['capabilities'];

export interface Cti {
  enabled: boolean;
  client: YeastarClient | null;
  tokens: TokenManager | null;
  extMap: ExtensionMap;
  machine: CallStateMachine;
  capabilities: () => Promise<CtiCapabilities>;
  popLatencies: number[];
}

export default fp(
  async function ctiPlugin(app: FastifyInstance) {
    const { config } = app;
    const enabled =
      config.YEASTAR_ENABLED &&
      Boolean(config.YEASTAR_BASE_URL && config.YEASTAR_CLIENT_ID && config.YEASTAR_CLIENT_SECRET);

    const extMap = new ExtensionMap(app.db, app.valkey, app.log);
    await extMap.start();

    let client: YeastarClient | null = null;
    let tokens: TokenManager | null = null;
    if (enabled) {
      const c = new YeastarClient({
        baseUrl: config.YEASTAR_BASE_URL ?? '',
        tls: {
          caFile: config.YEASTAR_TLS_CA_FILE,
          fingerprintSha256: config.YEASTAR_TLS_FINGERPRINT_SHA256,
        },
        getAccessToken: () => {
          if (!tokens) throw new Error('token manager not ready');
          return tokens.getAccessToken();
        },
        onTokenRejected: () => {
          if (!tokens) throw new Error('token manager not ready');
          return tokens.invalidateAndRenew();
        },
        log: app.log,
      });
      client = c;
      tokens = new TokenManager(
        app.valkey,
        {
          clientId: config.YEASTAR_CLIENT_ID ?? '',
          clientSecret: config.YEASTAR_CLIENT_SECRET ?? '',
        },
        c,
        app.log,
      );
    }

    const capabilities = async (): Promise<CtiCapabilities> => {
      await Promise.resolve();
      return {
        answer: !enabled ? 'none' : config.LINKUS_SDK_ENABLED ? 'webrtc' : 'api',
        decline: enabled,
        hangup: enabled,
        hold: enabled,
        mute: enabled,
        transfer: enabled,
      };
    };

    const popLatencies: number[] = [];
    const machine = new CallStateMachine({
      app,
      extMap,
      capabilities,
      pbxTimeZone: config.YEASTAR_TIMEZONE,
      onPopLatency: (ms) => {
        popLatencies.push(ms);
        if (popLatencies.length > 500) popLatencies.shift();
        if (ms > 1000) app.log.warn({ ms }, 'screen pop latency above 1s');
      },
    });

    const cti: Cti = { enabled, client, tokens, extMap, machine, capabilities, popLatencies };
    app.decorate('cti', cti);

    app.events.on('user.extension_changed', () => {
      extMap.refresh().catch(() => undefined);
    });

    app.readiness.register('pbx', async () => {
      if (!enabled) return { enabled: false };
      const status = await readCtiStatus(app.valkey);
      const token = await tokens?.read();
      return {
        enabled: true,
        connected: status.connected,
        lastEventAt: status.lastEventAt,
        tokenExpiresAt: token ? new Date(token.accessExpiresAt).toISOString() : null,
      };
    });

    app.addHook('onClose', async () => {
      await extMap.stop();
      await client?.close();
    });
  },
  { name: 'cti', dependencies: ['prisma', 'valkey', 'services', 'event-bus', 'socket', 'queues'] },
);
