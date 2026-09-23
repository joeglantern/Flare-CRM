/**
 * Extension sync job (docs/06 §18): ties each CRM user to their PBX extension by email, the way
 * Yeastar's own CRM integration does, and keeps a report of whatever it could not settle.
 *
 * The rule is in `integrations/yeastar/extension-link.ts`, where it is tested without a PBX. This
 * is the part that reads both sides and writes the one thing it is allowed to write: an extension
 * into a profile that had none. Nothing already set is ever changed.
 *
 * The report is kept in Valkey so the settings screen can show what the last run found without
 * asking the PBX again, and so the scheduled run and the "match now" button show the same thing.
 */
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import type { ExtensionLinkReport } from '@crm/shared';
import { ExtensionMap } from '../integrations/yeastar/extension-map.js';
import {
  planExtensionLinks,
  type CrmUser,
  type PbxExtension,
} from '../integrations/yeastar/extension-link.js';
import { SYSTEM_AUDIT } from '../modules/entitlements/entitlements.service.js';

const REPORT_KEY = 'cti:extension-links:last';

/** The PBX sends an empty string for a field nobody filled in; that is not a name or an address. */
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export async function runExtensionSync(app: FastifyInstance): Promise<ExtensionLinkReport | null> {
  const client = app.cti.client;
  if (!client) return null;
  const settings = await app.settings.getAll();
  if (!settings.extensionSync.enabled) return null;
  if (!(await app.entitlements.has('telephony'))) return null;

  const pbx: PbxExtension[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await client.extensionList({ page, page_size: 1000 });
    const rows = res.data ?? [];
    for (const r of rows) {
      if (typeof r.number !== 'string' || r.number === '') continue;
      pbx.push({
        number: r.number,
        name: blankToNull(r.caller_id_name),
        email: blankToNull(r.email_addr),
      });
    }
    if (rows.length < 1000) break;
  }

  const users: CrmUser[] = (
    await app.db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, extension: true },
    })
  ).map((u) => ({ id: u.id, name: u.name, email: u.email, extension: u.extension }));

  const plan = planExtensionLinks(pbx, users);

  const assigned: ExtensionLinkReport['assigned'] = [];
  for (const a of plan.assign) {
    try {
      // The unique index on `extension` is the last word: two runs racing for the same number
      // cannot both win, and the loser is simply reported next time round.
      await app.db.user.update({ where: { id: a.userId }, data: { extension: a.extension } });
      await app.audit.write(SYSTEM_AUDIT, {
        action: 'user.extension_matched',
        entity: 'user',
        entityId: a.userId,
        after: { extension: a.extension, by: 'email' },
      });
      assigned.push(a);
    } catch (err) {
      app.log.warn({ err, userId: a.userId, extension: a.extension }, 'could not assign extension');
    }
  }
  if (assigned.length > 0) await ExtensionMap.notifyChanged(app.valkey);

  const report: ExtensionLinkReport = {
    ranAt: new Date().toISOString(),
    pbxExtensions: pbx.length,
    matched: plan.matched,
    assigned,
    conflicts: plan.conflicts,
    unmatchedExtensions: plan.unmatchedExtensions,
    usersWithoutExtension: plan.usersWithoutExtension,
  };
  await app.valkey.set(REPORT_KEY, JSON.stringify(report));
  app.log.info(
    {
      pbxExtensions: report.pbxExtensions,
      matched: report.matched,
      assigned: assigned.length,
      conflicts: report.conflicts.length,
      unmatched: report.unmatchedExtensions.length,
      usersWithoutExtension: report.usersWithoutExtension.length,
    },
    'extension sync complete',
  );
  return report;
}

export async function lastExtensionSyncReport(valkey: Redis): Promise<ExtensionLinkReport | null> {
  const raw = await valkey.get(REPORT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExtensionLinkReport;
  } catch {
    return null;
  }
}
