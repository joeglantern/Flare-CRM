/**
 * Registers channel adapters and the messaging service; auto-provisions the WhatsApp channel
 * from env on first boot (docs/11).
 */
import type { ChannelType } from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { ChannelAdapter } from '../integrations/messaging/channel-adapter.js';
import { WhatsAppAdapter } from '../integrations/messaging/whatsapp-adapter.js';
import { newId } from '../lib/ids.js';
import { MessagingService } from '../modules/messaging/messaging.service.js';

export default fp(
  async function messagingPlugin(app: FastifyInstance) {
    const { config } = app;
    const adapters = new Map<ChannelType, ChannelAdapter>();
    const whatsapp = new WhatsAppAdapter({
      apiBaseUrl: config.WHATSAPP_API_BASE_URL,
      graphVersion: config.WHATSAPP_GRAPH_VERSION,
      appSecret: config.WHATSAPP_APP_SECRET,
      defaultAccessToken: config.WHATSAPP_ACCESS_TOKEN,
    });
    adapters.set('whatsapp', whatsapp);
    app.decorate('messaging', new MessagingService(app, adapters));
    app.decorate('whatsappAdapter', whatsapp);

    if (config.WHATSAPP_ENABLED && config.WHATSAPP_PHONE_NUMBER_ID) {
      const existing = await app.db.channel.findFirst({
        where: { type: 'whatsapp', externalId: config.WHATSAPP_PHONE_NUMBER_ID },
      });
      if (!existing) {
        await app.db.channel.create({
          data: {
            id: newId(),
            type: 'whatsapp',
            name: 'WhatsApp',
            externalId: config.WHATSAPP_PHONE_NUMBER_ID,
            config: {},
          },
        });
        app.log.info(
          { phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID },
          'WhatsApp channel provisioned from env',
        );
      }
    }
  },
  { name: 'messaging', dependencies: ['prisma', 'services', 'socket', 'queues'] },
);
