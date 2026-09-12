/**
 * Two things on this tab reach the server, and both are worth pinning down.
 *
 * The edit dialog has to send a partial: `PATCH /customers/:id` writes an audit row out of the body
 * it was given, so sending every field on every save makes the audit log useless for answering "who
 * changed their email".
 *
 * Suspending has to say what suspension actually is before it happens. The server reissues and
 * sends the document inside the same request, so the screen must not go on offering to do that
 * afterwards; the promise it makes in the dialog is the one the server actually keeps.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConsoleSettings, CustomerDetail, Me } from '@/lib/types';
import { renderWithQuery, stubFetch, type FetchStub } from '@/test/render';
import { OverviewTab } from './OverviewTab';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const STACK_ID = 'stk_abcdefghijklmnopqrst';
const CUSTOMER_PATH = `/api/v1/customers/${CUSTOMER_ID}`;

const detail: CustomerDetail = {
  customer: {
    id: CUSTOMER_ID,
    name: 'Acme Ltd',
    slug: 'acme',
    status: 'active',
    contactName: 'Jane Doe',
    contactEmail: 'jane@acme.example',
    contactPhone: '+254700000000',
    notes: 'Invoiced yearly.',
    primaryDomain: 'acme.raniafrica.co.ke',
    customDomain: null,
    customDomainVerifiedAt: null,
    suspendedAt: null,
    archivedAt: null,
    archiveReason: null,
    churnReason: null,
    churnedAt: null,
    onboardingStage: 'live',
    onboardingChecklist: {},
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  stacks: [
    {
      id: STACK_ID,
      label: 'primary',
      notes: '',
      connected: true,
      lastSeenAt: '2026-09-10T09:00:00.000Z',
      startedAt: '2026-09-10T06:00:00.000Z',
      version: 'abc1234',
      domain: 'acme.raniafrica.co.ke',
      lastBackupAt: null,
      revokedAt: null,
      currentIssueId: null,
      usage: null,
      health: null,
    },
  ],
  issues: [],
};

const settings: ConsoleSettings = {
  brandDomain: 'raniafrica.co.ke',
  consoleUrl: 'https://console.raniafrica.co.ke',
  ownerContact: { name: 'Flare', email: 'hello@raniafrica.co.ke' },
  signingKey: { keyId: 'key_1', publicKeySpkiBase64: 'AAAA', algorithm: 'Ed25519' },
};

/** Editing a customer and holding a stack's credentials are an owner's, so the tab asks first. */
const me: Me = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Liban',
  email: 'liban@example.com',
  role: 'owner',
  twoFactorEnabled: true,
  permissions: [
    'customer:read',
    'customer:write',
    'customer:archive',
    'customer:note',
    'stack:read',
    'stack:manage',
    'stack:operate',
  ],
};

let fetchStub: FetchStub | null = null;

function renderTab(customer: Partial<CustomerDetail['customer']> = {}) {
  fetchStub = stubFetch({
    'GET /api/v1/me': me,
    'GET /api/v1/console/settings': settings,
    // The tab now asks who the people are and what has been written down about them.
    [`GET ${CUSTOMER_PATH}/contacts`]: [],
    [`GET ${CUSTOMER_PATH}/notes`]: { data: [], page: { page: 1, pageSize: 10, total: 0 } },
    [`POST ${CUSTOMER_PATH}/notes`]: { id: 'note-1' },
    [`PATCH ${CUSTOMER_PATH}`]: { ...detail.customer, ...customer },
    [`POST ${CUSTOMER_PATH}/issue`]: { issues: [] },
    [`POST ${CUSTOMER_PATH}/archive`]: {
      ...detail.customer,
      archivedAt: '2026-09-12T00:00:00.000Z',
    },
  });
  return renderWithQuery(
    <OverviewTab detail={{ ...detail, customer: { ...detail.customer, ...customer } }} />,
  );
}

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
});

describe('the customer overview tab', () => {
  it('sends only the field the owner actually changed', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.clear(dialog.getByLabelText('Person'));
    await user.type(dialog.getByLabelText('Person'), 'John Doe');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchStub?.lastBody('PATCH', CUSTOMER_PATH)).toEqual({ contactName: 'John Doe' });
    });
  });

  it('sends a cleared phone number as null, not as an empty string', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.clear(dialog.getByLabelText('Phone'));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchStub?.lastBody('PATCH', CUSTOMER_PATH)).toEqual({ contactPhone: null });
    });
  });

  it('has nothing to save until something is edited', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('spells out what suspension does before it does it', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('tab', { name: 'Suspended' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/still sign in and read everything/)).toBeVisible();
    expect(dialog.getByText(/create, edit or delete anything is refused/)).toBeVisible();
    expect(dialog.getByText(/Nothing of theirs is deleted/)).toBeVisible();
    // Choosing a status on a segmented control is not the same as agreeing to it.
    expect(fetchStub?.requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('promises the document goes out at once when the stack is connected', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('tab', { name: 'Suspended' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(
      dialog.getByText(/sent a new document immediately and applies it at once/),
    ).toBeVisible();
  });

  it('promises instead that an offline stack collects it later', async () => {
    const user = userEvent.setup();
    fetchStub = stubFetch({
      'GET /api/v1/me': me,
      'GET /api/v1/console/settings': settings,
      [`GET ${CUSTOMER_PATH}/contacts`]: [],
      [`GET ${CUSTOMER_PATH}/notes`]: { data: [], page: { page: 1, pageSize: 10, total: 0 } },
      [`PATCH ${CUSTOMER_PATH}`]: detail.customer,
    });
    const offline = detail.stacks.map((stack) => ({ ...stack, connected: false }));
    renderWithQuery(<OverviewTab detail={{ ...detail, stacks: offline }} />);

    await user.click(await screen.findByRole('tab', { name: 'Suspended' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/applies the new document when it next connects/)).toBeVisible();
  });

  it('changes the status in one request, because the server sends the document itself', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('tab', { name: 'Suspended' }));
    await user.click(await screen.findByRole('button', { name: 'Suspended' }));

    await waitFor(() => {
      expect(fetchStub?.lastBody('PATCH', CUSTOMER_PATH)).toEqual({ status: 'suspended' });
    });
    // Issuing used to be a second thing an owner had to remember. It is not any more, and asking
    // for it again here would sign and deliver a duplicate document for no reason.
    expect(fetchStub?.requests.some((r) => r.path === `${CUSTOMER_PATH}/issue`)).toBe(false);
  });

  it('asks for the slug to be typed before filing a customer away', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Archive this customer' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(
      dialog.getByText(/Every attempt to change anything over there is refused/),
    ).toBeVisible();
    expect(dialog.getByText(/Nothing is deleted/)).toBeVisible();
    // Typing the slug is the gate: nothing has been sent while the question is still open.
    expect(fetchStub?.requests.some((r) => r.path === `${CUSTOMER_PATH}/archive`)).toBe(false);
  });

  it('sends only the checklist box that was ticked', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('checkbox', { name: 'Agreement signed' }));

    await waitFor(() => {
      expect(fetchStub?.lastBody('PATCH', CUSTOMER_PATH)).toEqual({
        onboardingChecklist: { agreement_signed: true },
      });
    });
  });

  it('says since when a held customer has been held', () => {
    renderTab({ status: 'suspended', suspendedAt: '2026-09-05T14:30:00.000Z' });

    expect(screen.getByText(/Held read only since 5 Sep 2026/)).toBeVisible();
  });
});
