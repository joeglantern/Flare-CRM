/**
 * Registers every module under /api/v1 (docs/09). Add new modules here only.
 */
import type { FastifyPluginAsync } from 'fastify';
import activityRoutes from './activity/activity.routes.js';
import auditRoutes from './audit/audit.routes.js';
import callsRoutes from './calls/calls.routes.js';
import companiesRoutes from './companies/companies.routes.js';
import contactsRoutes from './contacts/contacts.routes.js';
import customFieldsRoutes from './custom-fields/custom-fields.routes.js';
import dealsRoutes from './deals/deals.routes.js';
import filesRoutes from './files/files.routes.js';
import importExportRoutes from './import-export/import-export.routes.js';
import leadsRoutes from './leads/leads.routes.js';
import messagingRoutes from './messaging/messaging.routes.js';
import notesRoutes from './notes/notes.routes.js';
import notificationsRoutes from './notifications/notifications.routes.js';
import pipelinesRoutes from './pipelines/pipelines.routes.js';
import reportsRoutes from './reports/reports.routes.js';
import settingsRoutes from './settings/settings.routes.js';
import tasksRoutes from './tasks/tasks.routes.js';
import teamsRoutes from './teams/teams.routes.js';
import usersRoutes from './users/users.routes.js';
import { publicFormsRoutes, webFormsRoutes } from './web-forms/web-forms.routes.js';
import whatsappWebhookRoutes from './webhooks/whatsapp.routes.js';
import yeastarWebhookRoutes from './webhooks/yeastar.routes.js';

export const API_PREFIX = '/api/v1';

const modules: FastifyPluginAsync = async (app) => {
  await app.register(usersRoutes);
  await app.register(teamsRoutes);
  await app.register(settingsRoutes);
  await app.register(auditRoutes);
  await app.register(customFieldsRoutes);
  await app.register(companiesRoutes);
  await app.register(contactsRoutes);
  await app.register(pipelinesRoutes);
  await app.register(dealsRoutes);
  await app.register(leadsRoutes);
  await app.register(tasksRoutes);
  await app.register(notesRoutes);
  await app.register(activityRoutes);
  await app.register(notificationsRoutes);
  await app.register(callsRoutes);
  await app.register(reportsRoutes);
  await app.register(importExportRoutes);
  await app.register(webFormsRoutes);
  await app.register(messagingRoutes);
  await app.register(filesRoutes);
};

/** Webhooks are mounted at the root (no /api/v1 prefix). */
export const webhookModules: FastifyPluginAsync = async (app) => {
  await app.register(yeastarWebhookRoutes);
  await app.register(whatsappWebhookRoutes);
  await app.register(publicFormsRoutes);
};

export default modules;
