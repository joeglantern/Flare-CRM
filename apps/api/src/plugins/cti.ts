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
import {
  INTEGRATIONS_CHANNEL,
  pbxUsable,
  readPbx,
  type EffectivePbx,
} from '../modules/integrations/config.js';

export type CtiCapabilities = ServerEventPayload<'call:ringing'>['capabilities'];

export interface Cti {
  enabled: boolean;
  /** The PBX this process talks to: saved in Settings, else the server's .env. */
  pbx: EffectivePbx;
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
    const pbx = await readPbx(app.db, config);
    const enabled = pbxUsable(pbx);

    const extMap = new ExtensionMap(app.db, app.valkey, app.log);
    await extMap.start();

    let client: YeastarClient | null = null;
    let tokens: TokenManager | null = null;
    if (enabled) {
      const c = new YeastarClient({
        baseUrl: pbx.baseUrl ?? '',
        tls: pbx.tls,
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
          clientId: pbx.clientId ?? '',
          clientSecret: pbx.clientSecret ?? '',
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

    const cti: Cti = { enabled, pbx, client, tokens, extMap, machine, capabilities, popLatencies };
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

    /*
     * A new PBX means a new client, token and event stream in both processes. Rebuilding all of
     * that in place is where a half-switched process would come from, so each process instead
     * shuts down cleanly and its container brings it back up on the new settings, which takes a
     * few seconds. Outside production nothing restarts a process, so it says so and waits.
     */
    const pbxListener = app.valkey.duplicate();
    pbxListener.on('error', (err: unknown) => {
      app.log.warn({ err }, 'PBX settings listener connection error');
    });
    await pbxListener.subscribe(INTEGRATIONS_CHANNEL);
    pbxListener.on('message', (_channel, key) => {
      if (key !== 'pbx') return;
      if (config.NODE_ENV !== 'production') {
        app.log.warn('PBX settings changed; restart the api and worker to use them');
        return;
      }
      app.log.info('PBX settings changed; restarting to reconnect');
      // Long enough for the request that saved them to get its answer.
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1500).unref();
    });

    app.addHook('onClose', async () => {
      await pbxListener.quit().catch(() => undefined);
      await extMap.stop();
      await client?.close();
    });
  },
  { name: 'cti', dependencies: ['prisma', 'valkey', 'services', 'event-bus', 'socket', 'queues'] },
);
