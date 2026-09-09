/**
 * Render helper for component tests.
 *
 * Seeds the query cache with `me`, the public settings and the entitlements instead of mocking
 * fetch, so a component under test reads exactly what it reads in the app. Everything is
 * overridable; anything left out gets a sensible default (an admin with every permission, a
 * standalone plan with every feature on).
 */
import {
  DEFAULT_ENTITLEMENTS,
  statement,
  type EntitlementsDto,
  type Permission,
} from '@crm/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EntitlementsProvider } from '@/providers/entitlements';
import { SettingsProvider } from '@/providers/settings';
import { qk } from '@/lib/query';

export const ALL_PERMISSIONS: Permission[] = Object.entries(statement).flatMap(
  ([resource, actions]) =>
    (actions as readonly string[]).map((a) => `${resource}:${a}` as Permission),
);

export interface TestMe {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  extension: string | null;
  timezone: string;
  permissions: Permission[];
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  avatarUrl: string | null;
}

export const testMe = (over: Partial<TestMe> = {}): TestMe => ({
  id: '01a00000-0000-7000-8000-000000000001',
  name: 'Test Admin',
  email: 'admin@example.com',
  role: 'admin',
  teamId: null,
  extension: null,
  timezone: 'Africa/Nairobi',
  permissions: ALL_PERMISSIONS,
  twoFactorEnabled: true,
  twoFactorRequired: false,
  avatarUrl: null,
  ...over,
});

/**
 * A test names only the features, limits or usage it cares about; the rest come from the
 * defaults, which is why these three are partial rather than the full maps the DTO carries.
 */
export interface EntitlementsOverride extends Omit<
  Partial<EntitlementsDto>,
  'features' | 'limits' | 'usage'
> {
  features?: Partial<EntitlementsDto['features']>;
  limits?: Partial<EntitlementsDto['limits']>;
  usage?: Partial<EntitlementsDto['usage']>;
}

export const testEntitlements = (over: EntitlementsOverride = {}): EntitlementsDto => ({
  customerName: 'Test Customer Ltd',
  plan: { id: 'plan_test', name: 'Test plan' },
  ...over,
  features: { ...DEFAULT_ENTITLEMENTS.features, ...(over.features ?? {}) },
  limits: { ...DEFAULT_ENTITLEMENTS.limits, ...(over.limits ?? {}) },
  usage: {
    seats: { used: 3, max: null },
    storage: {
      usedBytes: 0,
      maxBytes: null,
      breakdown: { attachments: 0, recordings: 0, backups: 0 },
      refreshedAt: null,
    },
    channels: { used: 0, max: null },
    pipelines: { used: 1, max: null },
    recordingRetentionDays: { configured: 365, max: null, effective: 365 },
    ...(over.usage ?? {}),
  },
  expiresAt: over.expiresAt ?? null,
  expired: over.expired ?? false,
  expiresInDays: over.expiresInDays ?? null,
  ownerContact: over.ownerContact ?? { name: 'Flare Support', email: 'support@example.com' },
  source: over.source ?? 'console',
  receivedAt: over.receivedAt ?? '2026-09-01T00:00:00.000Z',
  issuedAt: over.issuedAt ?? '2026-09-01T00:00:00.000Z',
  issueId: over.issueId ?? 'iss_00000000-0000-7000-8000-000000000001',
  keyId: over.keyId ?? '0123456789abcdef',
  link: over.link ?? {
    configured: true,
    connected: true,
    lastHeartbeatAt: '2026-09-10T00:00:00.000Z',
  },
});

export interface RenderOptions {
  me?: Partial<TestMe>;
  entitlements?: EntitlementsOverride;
}

export function renderWithProviders(ui: ReactNode, options: RenderOptions = {}): RenderResult {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: 0 } },
  });
  qc.setQueryData(qk.me(), testMe(options.me));
  qc.setQueryData(qk.entitlements(), testEntitlements(options.entitlements));
  qc.setQueryData(qk.settingsPublic(), {
    defaultCountry: 'KE',
    currency: 'KES',
    popup: {
      popOnInternalCalls: false,
      autoOpenProfileOnAnswer: false,
      suggestFollowUpAfterCall: true,
    },
    security: { sessionIdleMinutes: 60 },
    recording: { consentText: '', allowAgentPlayback: true },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsProvider>
        <EntitlementsProvider>{ui}</EntitlementsProvider>
      </SettingsProvider>
    </QueryClientProvider>,
  );
}
