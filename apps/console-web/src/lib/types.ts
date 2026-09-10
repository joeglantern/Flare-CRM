/**
 * The console API's response shapes. The feature and limit maps come from `@crm/shared`, which is
 * the same catalogue the API validates against, so a new feature key reaches these screens by
 * adding it there and nowhere else.
 */
import type { FeatureKey, FeatureMap, LimitKey, LimitMap, OwnerContact } from '@crm/shared';
import type { IssueStatus, StackUsage } from '@crm/shared';

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
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  features: FeatureMap;
  limits: LimitMap;
  isDefault: boolean;
}

export interface Stack {
  id: string;
  label: string;
  connected: boolean;
  lastSeenAt: string | null;
  version: string | null;
  domain: string | null;
  lastBackupAt: string | null;
  revokedAt: string | null;
  currentIssueId: string | null;
  usage: StackUsage | null;
  health: { ok: boolean; checks: Record<string, { ok: boolean; error?: string }> } | null;
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
}

export interface CustomerEntitlements {
  planId: string | null;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  limitOverrides: Partial<Record<LimitKey, number | null>>;
  expiresAt: string | null;
  agreementNotes: string;
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

export interface Owner {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastSeenAt: string | null;
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
