/**
 * The editor an owner actually clicks: switching a feature off has to take its dependants with it on
 * screen, and Save has to send the overrides rather than the whole effective set. Sending the whole
 * set would silently pin every value and cut this customer off from later plan changes.
 */
import { DEFAULT_ENTITLEMENTS } from '@crm/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomerEntitlements, Issue, Me, Plan, Stack } from '@/lib/types';
import { renderWithQuery, stubFetch, type FetchStub } from '@/test/render';
import { EntitlementsTab } from './EntitlementsTab';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

const plan: Plan = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Standard',
  description: 'Everything except the softphone.',
  features: { ...DEFAULT_ENTITLEMENTS.features, softphone: false },
  limits: { ...DEFAULT_ENTITLEMENTS.limits, seats: 10, storage_gb: 20 },
  priceMonthlyMinor: 150000,
  currency: 'KES',
  isDefault: true,
};

const entitlements: CustomerEntitlements = {
  planId: plan.id,
  featureOverrides: {},
  limitOverrides: {},
  expiresAt: null,
  priceMonthlyMinorOverride: null,
  agreementNotes: '',
  effective: {
    plan: { id: plan.id, name: plan.name },
    features: plan.features,
    limits: plan.limits,
    expiresAt: null,
    priceMonthlyMinor: plan.priceMonthlyMinor,
    currency: plan.currency,
  },
};

const stack: Stack = {
  id: 'stk_abcdefghijklmnopqrst',
  label: 'primary',
  connected: true,
  lastSeenAt: '2026-09-10T00:00:00.000Z',
  version: 'abc1234',
  domain: 'acme.example.com',
  lastBackupAt: null,
  revokedAt: null,
  currentIssueId: null,
  usage: null,
  health: null,
};

const issues: Issue[] = [];

/** Saving and issuing are an owner's, so the editor asks who is signed in before it offers them. */
const me: Me = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Liban',
  email: 'liban@example.com',
  role: 'owner',
  twoFactorEnabled: true,
  permissions: ['entitlement:read', 'entitlement:issue'],
};

let fetchStub: FetchStub | null = null;

function renderTab() {
  fetchStub = stubFetch({
    'GET /api/v1/me': me,
    'GET /api/v1/plans': [plan],
    [`PUT /api/v1/customers/${CUSTOMER_ID}/entitlements`]: { ok: true },
    [`POST /api/v1/customers/${CUSTOMER_ID}/issue`]: { issues: [] },
  });
  return renderWithQuery(
    <EntitlementsTab
      customerId={CUSTOMER_ID}
      entitlements={entitlements}
      stacks={[stack]}
      issues={issues}
    />,
  );
}

/**
 * The plan arrives from its own request, and until it does the editor falls back to everything on.
 * Softphone is off in this plan and nowhere else, so it is the signal that the plan is on screen.
 *
 * Who is signed in arrives from a second request, and the buttons are held back until it does, so
 * this waits for both rather than racing whichever answers second.
 */
async function planLoaded(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('switch', { name: 'Softphone' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Issue and push/ })).toBeInTheDocument();
  });
}

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
});

describe('the entitlements editor screen', () => {
  it('shows what the plan gives, and marks it as coming from the plan', async () => {
    renderTab();
    await planLoaded();
    expect(screen.getByRole('switch', { name: 'Telephony' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Call recordings' })).toBeChecked();
    expect(screen.getAllByText('From plan').length).toBeGreaterThan(5);
  });

  it('takes recordings and the softphone down with telephony, and says why', async () => {
    const user = userEvent.setup();
    renderTab();
    await planLoaded();
    const telephony = screen.getByRole('switch', { name: 'Telephony' });

    await user.click(telephony);

    const recordings = screen.getByRole('switch', { name: 'Call recordings' });
    expect(recordings).not.toBeChecked();
    // Not merely unchecked: while its prerequisite is off there is nothing useful to click.
    expect(recordings).toBeDisabled();
    expect(screen.getAllByText(/Needs Telephony, which is off/).length).toBeGreaterThan(0);
  });

  it('saves the overrides, not the whole effective set', async () => {
    const user = userEvent.setup();
    renderTab();
    await planLoaded();
    const telephony = screen.getByRole('switch', { name: 'Telephony' });

    await user.click(telephony);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(
        fetchStub?.lastBody('PUT', `/api/v1/customers/${CUSTOMER_ID}/entitlements`),
      ).not.toBeNull();
    });
    const body = fetchStub?.lastBody('PUT', `/api/v1/customers/${CUSTOMER_ID}/entitlements`) as {
      featureOverrides: Record<string, boolean>;
      limitOverrides: Record<string, number | null>;
      expiresAt: string | null;
      planId: string;
    };
    expect(body.featureOverrides).toEqual({ telephony: false });
    expect(body.limitOverrides).toEqual({});
    expect(body.expiresAt).toBeNull();
    expect(body.planId).toBe(plan.id);
  });

  it('will not issue while there are unsaved changes', async () => {
    const user = userEvent.setup();
    renderTab();
    await planLoaded();
    const telephony = screen.getByRole('switch', { name: 'Telephony' });

    expect(screen.getByRole('button', { name: /Issue and push/ })).toBeEnabled();
    await user.click(telephony);
    // Issuing signs what is stored, so offering it here would send the previous document.
    expect(screen.getByRole('button', { name: /Issue and push/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('switch', { name: 'Telephony' })).toBeChecked();
    expect(screen.getByRole('button', { name: /Issue and push/ })).toBeEnabled();
  });

  it('sends an expiry as the end of the chosen day', async () => {
    const user = userEvent.setup();
    renderTab();
    await planLoaded();

    await user.type(screen.getByLabelText('Expiry date'), '2026-12-31');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(
        fetchStub?.lastBody('PUT', `/api/v1/customers/${CUSTOMER_ID}/entitlements`),
      ).not.toBeNull();
    });
    const body = fetchStub?.lastBody('PUT', `/api/v1/customers/${CUSTOMER_ID}/entitlements`) as {
      expiresAt: string;
    };
    const expiry = new Date(body.expiresAt);
    expect(expiry.getFullYear()).toBe(2026);
    expect(expiry.getMonth()).toBe(11);
    expect(expiry.getDate()).toBe(31);
    expect(expiry.getHours()).toBe(23);
  });
});
