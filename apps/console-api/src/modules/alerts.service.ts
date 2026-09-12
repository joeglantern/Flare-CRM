/**
 * What an owner should look at (docs/21 §8).
 *
 * Every few minutes this asks the fleet a set of questions and keeps at most one open alert per
 * question per customer per stack. That single rule is what stops a stack that is down for a
 * weekend from becoming three thousand emails: the alert opens once, the owner is told once, and it
 * closes itself when the thing it was about stops being true.
 *
 * An alert is a fact with a timestamp, not a notification. The email is a consequence of opening
 * one, and the console shows the same list whether or not the mail server was reachable. What an
 * owner does about it is recorded beside it: acknowledged, set aside, muted, or closed by hand. A
 * closed alert whose cause is still true opens again as a new row rather than quietly reappearing,
 * so the decision to close it stays on the record.
 */
import { ALERTS, alertCopy, type AlertKind, type AlertLevel, type StackUsage } from '@crm/shared';
import type { Mailer } from '../plugins/mailer.js';
import type { Db } from '../plugins/prisma.js';
import { alertClearedEmail, alertOpenedEmail, consoleSender } from '../lib/email.js';
import { newId } from '../lib/ids.js';
import type { ConsoleSettingsService } from './settings.service.js';
import {
  backupStale,
  driftedFrom,
  expiryState,
  fleetVersion,
  isOffline,
  neverConnected,
  trialEnding,
  undelivered,
  worstCapRatio,
} from './alerts.rules.js';

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
  /** Where the customer's CRM answers, so the email names the installation and not only a name. */
  customerHost: string;
  stackId: string | null;
  summary: string;
  context: Record<string, unknown>;
}

interface Logger {
  info: (o: unknown, m: string) => void;
  error: (o: unknown, m: string) => void;
}

/** One open alert per question, per customer, per stack. */
function keyOf(f: { kind: string; customerId: string; stackId: string | null }): string {
  return `${f.kind}:${f.customerId}:${f.stackId ?? ''}`;
}

export class AlertsService {
  constructor(
    private readonly deps: {
      db: Db;
      mailer: Mailer;
      log: Logger;
      settings: ConsoleSettingsService;
      consoleUrl: string;
      markUrl?: string;
      recipientsFor: (kind: string) => Promise<string[]>;
      onChange: (change: AlertChange) => void;
    },
  ) {}

  /** Runs every check, opens what is newly true, closes what is no longer true. */
  async sweep(now = new Date()): Promise<{ opened: number; resolved: number; muted: number }> {
    const thresholds = await this.deps.settings.alertThresholds();
    const [findings, open, mutes] = await Promise.all([
      this.look(now, thresholds),
      // A closed alert is not an open one: if its cause is still true, a fresh row opens below.
      this.deps.db.consoleAlert.findMany({ where: { resolvedAt: null, closedAt: null } }),
      this.deps.db.alertMute.findMany({
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      }),
    ]);

    const found = new Map(findings.map((f) => [keyOf(f), f]));
    const openKeys = new Set(open.map((a) => keyOf(a)));

    let opened = 0;
    let resolved = 0;
    let muted = 0;

    for (const [key, finding] of found) {
      if (openKeys.has(key)) continue;
      const silenced = mutes.some(
        (m) =>
          (m.kind === null || m.kind === finding.kind) &&
          (m.customerId === null || m.customerId === finding.customerId),
      );
      if (silenced) {
        muted += 1;
        continue;
      }
      await this.open(finding, now);
      opened += 1;
    }

    for (const alert of open) {
      if (found.has(keyOf(alert))) continue;
      await this.close(alert.id, now);
      resolved += 1;
    }

    return { opened, resolved, muted };
  }

  private async look(
    now: Date,
    thresholds: Awaited<ReturnType<ConsoleSettingsService['alertThresholds']>>,
  ): Promise<Finding[]> {
    const [customers, outstanding, everyStack] = await Promise.all([
      this.deps.db.customer.findMany({
        where: { status: 'active', archivedAt: null },
        include: {
          entitlement: { include: { plan: true } },
          stacks: { where: { revokedAt: null } },
        },
      }),
      this.deps.db.entitlementIssue.findMany({
        where: { status: { in: ['pending', 'delivered'] }, stack: { revokedAt: null } },
        orderBy: { issuedAt: 'desc' },
      }),
      this.deps.db.stack.findMany({
        where: { revokedAt: null, connected: true },
        select: { version: true },
      }),
    ]);

    // What the fleet has settled on, so one stack left behind can be told apart from a rollout.
    const settled = fleetVersion(everyStack.map((s) => s.version));
    const newestIssueFor = new Map<string, { issuedAt: Date; status: string }>();
    for (const issue of outstanding) {
      if (!newestIssueFor.has(issue.stackId)) {
        newestIssueFor.set(issue.stackId, { issuedAt: issue.issuedAt, status: issue.status });
      }
    }

    const findings: Finding[] = [];
    for (const customer of customers) {
      const host = customer.customDomain ?? customer.primaryDomain;
      const add = (
        kind: AlertKind,
        stackId: string | null,
        summary: string,
        context: Record<string, unknown>,
      ) => {
        findings.push({
          kind,
          customerId: customer.id,
          customerName: customer.name,
          customerHost: host,
          stackId,
          summary,
          context,
        });
      };

      for (const stack of customer.stacks) {
        if (neverConnected(stack, now, thresholds)) {
          add(
            'stack_never_connected',
            stack.id,
            `Credentials were issued ${hours(now.getTime() - stack.createdAt.getTime())} ago and this stack has never reported in.`,
            { createdAt: stack.createdAt.toISOString(), label: stack.label },
          );
          // Nothing else can be said about a server that has never spoken.
          continue;
        }

        if (isOffline(stack.lastSeenAt, now, thresholds)) {
          const silentMs = now.getTime() - (stack.lastSeenAt?.getTime() ?? now.getTime());
          add('stack_offline', stack.id, `Last heard from ${minutes(silentMs)} ago.`, {
            minutes: Math.round(silentMs / 60_000),
            lastSeenAt: stack.lastSeenAt?.toISOString() ?? null,
          });
          continue;
        }

        if (stack.lastSeenAt === null) continue;

        const health = (stack.health ?? null) as {
          ok?: boolean;
          checks?: Record<string, { ok: boolean }>;
        } | null;
        const failing = Object.entries(health?.checks ?? {})
          .filter(([, c]) => !c.ok)
          .map(([name]) => name);
        if (health?.ok === false && failing.length > 0) {
          add('stack_unhealthy', stack.id, `Failing checks: ${failing.join(', ')}.`, { failing });
        }

        if (backupStale(stack.lastBackupAt, now, thresholds)) {
          add(
            'backup_stale',
            stack.id,
            stack.lastBackupAt === null
              ? 'No backup has ever been reported for this stack.'
              : `Last backup was ${hours(now.getTime() - stack.lastBackupAt.getTime())} ago.`,
            { lastBackupAt: stack.lastBackupAt?.toISOString() ?? null },
          );
        }

        const waiting = newestIssueFor.get(stack.id) ?? null;
        if (undelivered(waiting, stack.connected, now, thresholds)) {
          add(
            'document_undelivered',
            stack.id,
            `Connected, but has not applied the document it was sent ${minutes(now.getTime() - (waiting?.issuedAt.getTime() ?? 0))} ago.`,
            { issuedAt: waiting?.issuedAt.toISOString() ?? null, status: waiting?.status ?? null },
          );
        }

        if (driftedFrom(stack.version, settled)) {
          add(
            'version_drift',
            stack.id,
            `Running ${stack.version ?? 'an unknown version'} while the fleet is on ${settled ?? 'another version'}.`,
            { version: stack.version, fleet: settled },
          );
        }

        const entitlement = customer.entitlement;
        const usage = (stack.usage ?? null) as StackUsage | null;
        if (entitlement !== null && usage !== null) {
          const merged = {
            ...((entitlement.plan?.limits ?? {}) as Record<string, number | null>),
            ...((entitlement.limitOverrides ?? {}) as Record<string, number | null>),
          };
          const worst = worstCapRatio(usage, {
            seats: typeof merged.seats === 'number' ? merged.seats : null,
            storageGb: typeof merged.storage_gb === 'number' ? merged.storage_gb : null,
          });
          if (worst !== null && worst.ratio >= 1) {
            add('cap_reached', stack.id, `${worst.what} is at the limit of ${worst.max}.`, {
              what: worst.what,
              used: worst.used,
              max: worst.max,
            });
          } else if (worst !== null && worst.ratio >= thresholds.capNearRatio) {
            add(
              'cap_near',
              stack.id,
              `${worst.what} is at ${Math.round(worst.ratio * 100)} percent of ${worst.max}.`,
              { what: worst.what, used: worst.used, max: worst.max },
            );
          }
        }
      }

      // The rest are about the agreement rather than any one server, so they carry no stack.
      const entitlement = customer.entitlement;
      const expiry = expiryState(entitlement?.expiresAt ?? null, now, thresholds);
      if (expiry?.state === 'expired') {
        add('plan_expired', null, `The plan ran out ${String(expiry.days)} days ago.`, {
          expiresAt: entitlement?.expiresAt?.toISOString() ?? null,
        });
      } else if (expiry?.state === 'expiring') {
        add('plan_expiring', null, `The plan runs out in ${String(expiry.days)} days.`, {
          expiresAt: entitlement?.expiresAt?.toISOString() ?? null,
          days: expiry.days,
        });
      }

      const trial = trialEnding(entitlement?.trialEndsAt ?? null, now, thresholds);
      if (trial !== null) {
        add('trial_ending', null, `The trial ends in ${String(trial.days)} days.`, {
          trialEndsAt: entitlement?.trialEndsAt?.toISOString() ?? null,
          days: trial.days,
        });
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
        add(
          'document_rejected',
          refused.stackId,
          refused.rejectReason ?? 'The stack refused its entitlements.',
          { issueId: refused.id, reason: refused.rejectReason },
        );
      }
    }
    return findings;
  }

  private async open(finding: Finding, now: Date): Promise<void> {
    const level = ALERTS[finding.kind].level;
    // If this was closed by hand and has come back, say so on the new row rather than reopening
    // the old one: the close was a decision somebody made and it stays in the record.
    const closedBefore = await this.deps.db.consoleAlert.findFirst({
      where: {
        kind: finding.kind,
        customerId: finding.customerId,
        stackId: finding.stackId,
        closedAt: { not: null },
      },
      orderBy: { closedAt: 'desc' },
    });

    const created = await this.deps.db.consoleAlert.create({
      data: {
        id: newId(),
        kind: finding.kind,
        level,
        customerId: finding.customerId,
        stackId: finding.stackId,
        openedAt: now,
        summary: finding.summary,
        context: {
          ...finding.context,
          summary: finding.summary,
          ...(closedBefore === null ? {} : { reopenedFrom: closedBefore.id }),
        },
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
      include: { customer: { select: { name: true, primaryDomain: true, customDomain: true } } },
    });
    this.deps.onChange({
      id: alert.id,
      kind: alert.kind as AlertKind,
      level: alert.level as AlertLevel,
      customerId: alert.customerId,
      customerName: alert.customer.name,
      stackId: alert.stackId,
      open: false,
      summary: `${alertCopy(alert.kind).label} has cleared.`,
      context: (alert.context ?? {}) as Record<string, unknown>,
    });
    // The opening email promised one more message when it cleared. An alert nobody was told about
    // closes quietly, so an owner never hears of something clearing that never reached them.
    if (alert.notifyCount === 0) return;
    const to = await this.deps.recipientsFor(alert.kind);
    for (const recipient of to) {
      try {
        await this.deps.mailer.send(
          alertClearedEmail({
            to: recipient,
            customerName: alert.customer.name,
            customerHost: alert.customer.customDomain ?? alert.customer.primaryDomain,
            label: alertCopy(alert.kind).label,
            openedAt: alert.openedAt,
            clearedAt: now,
            url: this.customerLink(alert.customerId),
            sender: this.sender(),
          }),
        );
      } catch (err) {
        this.deps.log.error(
          { err, kind: alert.kind, customerId: alert.customerId },
          'alert cleared email failed',
        );
      }
    }
  }

  private sender() {
    return consoleSender(this.deps.consoleUrl, this.deps.markUrl);
  }

  private customerLink(customerId: string): string {
    return `${this.deps.consoleUrl.replace(/\/+$/, '')}/customers/${customerId}`;
  }

  /** One email per alert, to whoever is down for that kind. */
  private async notify(finding: Finding, level: AlertLevel, now: Date, id: string): Promise<void> {
    const definition = ALERTS[finding.kind];
    const recipients = await this.deps.recipientsFor(finding.kind);
    let sent = 0;
    for (const to of recipients) {
      try {
        await this.deps.mailer.send(
          alertOpenedEmail({
            to,
            customerName: finding.customerName,
            customerHost: finding.customerHost,
            label: definition.label,
            description: definition.description,
            summary: finding.summary,
            danger: level === 'danger',
            since: now,
            url: this.customerLink(finding.customerId),
            sender: this.sender(),
          }),
        );
        sent += 1;
      } catch (err) {
        // The alert is the record; the email is a courtesy. A dead mail server must not lose it.
        this.deps.log.error(
          { err, kind: finding.kind, customerId: finding.customerId },
          'alert email failed',
        );
      }
    }
    if (sent > 0) {
      await this.deps.db.consoleAlert.update({
        where: { id },
        data: { lastNotifiedAt: now, notifyCount: { increment: sent } },
      });
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
