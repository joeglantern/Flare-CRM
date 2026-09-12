/**
 * The console API's response shapes. The feature and limit maps come from `@crm/shared`, which is
 * the same catalogue the API validates against, so a new feature key reaches these screens by
 * adding it there and nowhere else.
 */
import type { FeatureKey, FeatureMap, LimitKey, LimitMap, OwnerContact } from '@crm/shared';
import type { IssueStatus, StackUsage, SupportUser } from '@crm/shared';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  twoFactorEnabled: boolean;
  permissions: string[];
}

export interface Customer {
  id: string;
  name: string;
  slug: string;
  status: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  notes: string;
  primaryDomain: string;
  customDomain: string | null;
  customDomainVerifiedAt: string | null;
  /** Set while we are holding this customer read only, and null the rest of the time. */
  suspendedAt: string | null;
  /** Filed away: out of the fleet by default, with nothing of theirs removed. */
  archivedAt: string | null;
  archiveReason: string | null;
  churnReason: string | null;
  churnedAt: string | null;
  onboardingStage: string;
  onboardingChecklist: Record<string, boolean>;
  createdAt: string;
}

/** Somebody at the customer worth ringing. The one on the customer row is who we bill. */
export interface CustomerContact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isPrimary: boolean;
  notes: string;
  createdAt: string;
}

/** A dated entry about this customer, as opposed to the standing paragraph on the row itself. */
export interface CustomerNote {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  pinned: boolean;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  features: FeatureMap;
  limits: LimitMap;
  /** Minor units of `currency`, so 1,500 KES is 150000. Null means the plan is not sold. */
  priceMonthlyMinor: number | null;
  currency: string;
  isDefault: boolean;
  /** Retired: not offered to anybody new, without deleting one customers are still on. */
  isArchived: boolean;
  /** How many customers are on it, which is what makes retiring or deleting it a real decision. */
  customers: number;
}

/** One customer on a plan, as the plan's own list returns them. */
export interface PlanCustomer {
  customerId: string;
  name: string;
  status: string;
  chargedPriceMonthlyMinor: number;
  priceState: 'trial' | 'discounted' | 'expired' | 'full';
  renewsOn: string | null;
  expiresAt: string | null;
}

export interface Stack {
  id: string;
  label: string;
  /** Whatever an operator needs to remember about this particular server. */
  notes: string;
  connected: boolean;
  lastSeenAt: string | null;
  /** When that server last came up, which it reports on every hello. */
  startedAt: string | null;
  version: string | null;
  domain: string | null;
  lastBackupAt: string | null;
  revokedAt: string | null;
  currentIssueId: string | null;
  usage: StackUsage | null;
  health: { ok: boolean; checks: Record<string, { ok: boolean; error?: string }> } | null;
}

/** A stack as the fleet-wide list returns it: the server, plus whose it is. */
export interface StackRow extends Stack {
  customer: { id: string; name: string; slug: string };
}

/** One heartbeat kept, at the five minute resolution the console samples at. */
export interface StackSample {
  at: string;
  seatsActive: number;
  storageBytes: number;
  readyOk: boolean;
  version: string | null;
}

export interface Issue {
  id: string;
  stackId: string;
  status: IssueStatus;
  issuedAt: string;
  deliveredAt: string | null;
  ackedAt: string | null;
  rejectReason: string | null;
}

export interface CustomerDetail {
  customer: Customer;
  stacks: Stack[];
  issues: Issue[];
}

export interface FleetRow {
  customer: Customer;
  plan: { id: string; name: string } | null;
  expiresAt: string | null;
  stacks: Stack[];
  connected: boolean;
  seats: { used: number | null; max: number | null };
  storageBytes: number | null;
  lastSeenAt: string | null;
  lastBackupAt: string | null;
  version: string | null;
}

export interface EffectiveEntitlements {
  plan: { id: string; name: string } | null;
  features: FeatureMap;
  limits: LimitMap;
  expiresAt: string | null;
  /** What this customer is actually billed: their override, or the plan's price. */
  priceMonthlyMinor: number | null;
  currency: string;
  /** The shelf price before a trial or a discount is applied to it. */
  listPriceMonthlyMinor: number;
  /** What they are billed this month once a trial, a discount or an expiry is taken into account. */
  chargedPriceMonthlyMinor: number;
  priceState: 'trial' | 'discounted' | 'expired' | 'full';
}

export interface CustomerEntitlements {
  planId: string | null;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  limitOverrides: Partial<Record<LimitKey, number | null>>;
  expiresAt: string | null;
  /** What the expiry was before they were held, so lifting it gives back that date and not forever. */
  expiresAtBeforeSuspension: string | null;
  /** Minor units, and null to charge whatever the plan charges. */
  priceMonthlyMinorOverride: number | null;
  agreementNotes: string;
  /** Paying nothing until this moment, and the full price after it. */
  trialEndsAt: string | null;
  /** The day the agreement comes round again. */
  renewsOn: string | null;
  /** Whole percent off the list price, with an optional end and the reason it was given. */
  discountPercent: number | null;
  discountUntil: string | null;
  discountNote: string;
  effective: EffectiveEntitlements;
}

export interface NewStackCredentials {
  stackId: string;
  secret: string;
  envLines: string[];
}

export interface DomainRecords {
  customDomain: string | null;
  cnameTarget: string;
  txtName: string | null;
  txtValue: string | null;
}

export interface DomainCheck {
  verified: boolean;
  cname: { ok: boolean; found: string[] };
  txt: { ok: boolean };
  primaryResolves: { ok: boolean; addresses: string[] };
}

/**
 * What the support endpoints answer with. A refusal from the customer's own stack arrives as a 409
 * carrying that stack's own words, not as an `ok: false` body, so there is no failure shape here.
 */
export interface SupportListing {
  stackId: string;
  users: SupportUser[];
}

export interface SupportOutcome {
  ok: true;
  message: string;
}

/** One announcement that was pushed to this customer's stacks, newest first on screen. */
export interface Announcement {
  id: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  /** How many stacks had it delivered to them at the moment it was sent. */
  delivered: number;
  sentByName: string | null;
  sentAt: string;
}

export interface Owner {
  id: string;
  name: string;
  email: string;
  /** `owner` or `support`; an account created before the second role existed reads as an owner. */
  role: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastSeenAt: string | null;
}

/** One alert as the inbox reads it: the fact, and how it stands with whoever is looking after it. */
export interface Alert {
  id: string;
  kind: string;
  level: 'info' | 'warning' | 'danger';
  state: 'open' | 'acked' | 'snoozed' | 'resolved' | 'closed';
  customerId: string;
  customerName: string;
  stackId: string | null;
  summary: string;
  openedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  snoozedUntil: string | null;
  closedAt: string | null;
  closeReason: string | null;
  context: Record<string, unknown>;
}

/** How many alerts stand in each state, for the nav badge and the inbox header. */
export interface AlertSummary {
  open: number;
  acked: number;
  snoozed: number;
  byLevel: { danger: number; warning: number; info: number };
}

export interface AlertMute {
  id: string;
  kind: string | null;
  customerId: string | null;
  customerName: string | null;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface ConsoleSettings {
  brandDomain: string;
  consoleUrl: string;
  ownerContact: OwnerContact;
  signingKey: { keyId: string; publicKeySpkiBase64: string; algorithm: 'Ed25519' };
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorType: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface Catalogue {
  features: { key: string; label: string; description: string; requires: string[] }[];
  limits: { key: string; label: string; unit: string; description: string }[];
}
