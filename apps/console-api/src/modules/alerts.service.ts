/**
 * What an owner should look at (docs/21 §8).
 *
 * Every few minutes this asks eight questions of the fleet and keeps at most one open alert per
 * question per customer. That single rule is what stops a stack that is down for a weekend from
 * becoming three thousand emails: the alert opens once, the owner is told once, and it closes
 * itself when the thing it was about stops being true.
 *
 * An alert is a fact with a timestamp, not a notification. The email is a consequence of opening
 * one, and the console shows the same list whether or not the mail server was reachable.
 */
import { ALERTS, type AlertKind, type AlertLevel, type StackUsage } from '@crm/shared';
import type { Mailer } from '../plugins/mailer.js';
import type { Db } from '../plugins/prisma.js';
import { newId } from '../lib/ids.js';

/** A stack that has not been heard from in this long is a problem worth an email. */
const OFFLINE_AFTER_MS = 10 * 60_000;
/** Below this the stack is unwell but may be recovering; above it, say so. */
const UNHEALTHY_AFTER_MS = 15 * 60_000;
const BACKUP_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 14;
const CAP_NEAR = 0.8;

export interface AlertChange {
  id: string;
  kind: AlertKind;
  level: AlertLevel;
  customerId: string;
  customerName: string;
  stackId: string | null;
  open: boolean;
  summary: string;
  context: Record<string, unknown>;
}

interface Finding {
  kind: AlertKind;
  customerId: string;
  customerName: string;
  stackId: string | null;
  summary: string;
  context: Record<string, unknown>;
}

interface Logger {
  info: (o: unknown, m: string) => void;
  error: (o: unknown, m: string) => void;
}

export class AlertsService {
  constructor(
    private readonly deps: {
      db: Db;
      mailer: Mailer;
      log: Logger;
      consoleUrl: string;
      ownerEmail: () => Promise<string>;
      onChange: (change: AlertChange) => void;
    },
  ) {}

  /** Runs every check, opens what is newly true, closes what is no longer true. */
  async sweep(now = new Date()): Promise<{ opened: number; resolved: number }> {
    const findings = await this.look(now);
    const open = await this.deps.db.consoleAlert.findMany({ where: { resolvedAt: null } });
    const found = new Map(findings.map((f) => [`${f.kind}:${f.customerId}`, f]));

    let opened = 0;
    let resolved = 0;

    for (const [key, finding] of found) {
      if (open.some((a) => `${a.kind}:${a.customerId}` === key)) continue;
      await this.open(finding, now);
      opened += 1;
    }

    for (const alert of open) {
      if (found.has(`${alert.kind}:${alert.customerId}`)) continue;
      await this.close(alert.id, now);
      resolved += 1;
    }

    return { opened, resolved };
  }

  private async look(now: Date): Promise<Finding[]> {
    const customers = await this.deps.db.customer.findMany({
      where: { status: 'active' },
      include: {
        entitlement: { include: { plan: true } },
        stacks: { where: { revokedAt: null } },
      },
    });

    const findings: Finding[] = [];
    for (const customer of customers) {
      const stack =
        customer.stacks.find((s) => s.connected) ??
        [...customer.stacks].sort(
          (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
        )[0];
      const add = (kind: AlertKind, summary: string, context: Record<string, unknown>) => {
        findings.push({
          kind,
          customerId: customer.id,
          customerName: customer.name,
          stackId: stack?.id ?? null,
          summary,
          context,
        });
      };

      // A customer with no stack yet is not a fault; there is simply nothing to watch.
      if (stack && stack.lastSeenAt !== null) {
        const silentMs = now.getTime() - stack.lastSeenAt.getTime();
        if (silentMs > OFFLINE_AFTER_MS) {
          add('stack_offline', `Last heard from ${minutes(silentMs)} ago.`, {
            minutes: Math.round(silentMs / 60_000),
            lastSeenAt: stack.lastSeenAt.toISOString(),
          });
        } else {
          const health = (stack.health ?? null) as {
            ok?: boolean;
            checks?: Record<string, { ok: boolean }>;
          } | null;
          const failing = Object.entries(health?.checks ?? {})
            .filter(([, c]) => !c.ok)
            .map(([name]) => name);
          if (health?.ok === false && silentMs < UNHEALTHY_AFTER_MS && failing.length > 0) {
            add('stack_unhealthy', `Failing checks: ${failing.join(', ')}.`, { failing });
          }
        }

        if (
          stack.lastBackupAt === null ||
          now.getTime() - stack.lastBackupAt.getTime() > BACKUP_STALE_AFTER_MS
        ) {
          add(
            'backup_stale',
            stack.lastBackupAt === null
              ? 'No backup has ever been reported for this stack.'
              : `Last backup was ${hours(now.getTime() - stack.lastBackupAt.getTime())} ago.`,
            { lastBackupAt: stack.lastBackupAt?.toISOString() ?? null },
          );
        }

        const usage = (stack.usage ?? null) as StackUsage | null;
        const entitlement = customer.entitlement;
        if (usage && entitlement) {
          const limits = {
            ...((entitlement.plan?.limits ?? {}) as Record<string, number | null>),
            ...((entitlement.limitOverrides ?? {}) as Record<string, number | null>),
          };
          const seatCap = typeof limits.seats === 'number' ? limits.seats : null;
          const storageCap =
            typeof limits.storage_gb === 'number' ? limits.storage_gb * 1024 ** 3 : null;
          const ratios: { what: string; used: number; max: number }[] = [];
          if (seatCap !== null && seatCap > 0)
            ratios.push({ what: 'seats', used: usage.seatsActive, max: seatCap });
          if (storageCap !== null && storageCap > 0)
            ratios.push({ what: 'storage', used: usage.storageBytes, max: storageCap });
          const worst = ratios.sort((a, b) => b.used / b.max - a.used / a.max)[0];
          if (worst) {
            const ratio = worst.used / worst.max;
            if (ratio >= 1) {
              add('cap_reached', `${worst.what} is at the limit of ${worst.max}.`, worst);
            } else if (ratio >= CAP_NEAR) {
              add(
                'cap_near',
                `${worst.what} is at ${Math.round(ratio * 100)} percent of ${worst.max}.`,
                worst,
              );
            }
          }
        }
      }

      const expiresAt = customer.entitlement?.expiresAt ?? null;
      if (expiresAt !== null) {
        const days = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
        if (days < 0) {
          add('plan_expired', `The plan ran out ${String(Math.abs(days))} days ago.`, {
            expiresAt: expiresAt.toISOString(),
          });
        } else if (days <= EXPIRY_WARNING_DAYS) {
          add('plan_expiring', `The plan runs out in ${String(days)} days.`, {
            expiresAt: expiresAt.toISOString(),
            days,
          });
        }
      }

      const refused = await this.deps.db.entitlementIssue.findFirst({
        where: { customerId: customer.id, status: 'rejected' },
        orderBy: { issuedAt: 'desc' },
      });
      const newer = await this.deps.db.entitlementIssue.findFirst({
        where: { customerId: customer.id, status: 'acked' },
        orderBy: { ackedAt: 'desc' },
      });
      // A refusal only matters while it is the last word: an accepted document after it settles it.
      if (
        refused &&
        (newer === null || (newer.ackedAt?.getTime() ?? 0) < refused.issuedAt.getTime())
      ) {
        add('document_rejected', refused.rejectReason ?? 'The stack refused its entitlements.', {
          issueId: refused.id,
          reason: refused.rejectReason,
        });
      }
    }
    return findings;
  }

  private async open(finding: Finding, now: Date): Promise<void> {
    const level = ALERTS[finding.kind].level;
    const created = await this.deps.db.consoleAlert.create({
      data: {
        id: newId(),
        kind: finding.kind,
        level,
        customerId: finding.customerId,
        stackId: finding.stackId,
        openedAt: now,
        context: { ...finding.context, summary: finding.summary },
      },
    });
    this.deps.onChange({
      id: created.id,
      kind: finding.kind,
      level,
      customerId: finding.customerId,
      customerName: finding.customerName,
      stackId: finding.stackId,
      open: true,
      summary: finding.summary,
      context: finding.context,
    });
    await this.notify(finding, level, now, created.id);
  }

  private async close(id: string, now: Date): Promise<void> {
    const alert = await this.deps.db.consoleAlert.update({
      where: { id },
      data: { resolvedAt: now },
      include: { customer: { select: { name: true } } },
    });
    this.deps.onChange({
      id: alert.id,
      kind: alert.kind as AlertKind,
      level: alert.level as AlertLevel,
      customerId: alert.customerId,
      customerName: alert.customer.name,
      stackId: alert.stackId,
      open: false,
      summary: `${ALERTS[alert.kind as AlertKind].label} has cleared.`,
      context: (alert.context ?? {}) as Record<string, unknown>,
    });
  }

  /** One email per alert, to whoever the console is told is the provider's contact. */
  private async notify(finding: Finding, level: AlertLevel, now: Date, id: string): Promise<void> {
    const definition = ALERTS[finding.kind];
    const to = await this.deps.ownerEmail();
    const subject = `${level === 'danger' ? 'Attention' : 'Notice'}: ${definition.label} at ${finding.customerName}`;
    const link = `${this.deps.consoleUrl}/customers/${finding.customerId}`;
    const text = [
      `${definition.label} at ${finding.customerName}.`,
      '',
      finding.summary,
      definition.description,
      '',
      link,
    ].join('\n');
    try {
      await this.deps.mailer.send({
        to,
        subject,
        text,
        html: `<p><strong>${escape(definition.label)} at ${escape(finding.customerName)}.</strong></p><p>${escape(finding.summary)}</p><p>${escape(definition.description)}</p><p><a href="${link}">Open the console</a></p>`,
      });
      await this.deps.db.consoleAlert.update({ where: { id }, data: { lastNotifiedAt: now } });
    } catch (err) {
      // The alert is the record; the email is a courtesy. A dead mail server must not lose it.
      this.deps.log.error(
        { err, kind: finding.kind, customerId: finding.customerId },
        'alert email failed',
      );
    }
  }
}

function minutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${String(m)} minutes` : hours(ms);
}

function hours(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `${String(h)} hours` : `${String(Math.round(h / 24))} days`;
}

function escape(value: string): string {
  return value.replace(/[<>&"]/g, (c) => `&#${String(c.charCodeAt(0))};`);
}
