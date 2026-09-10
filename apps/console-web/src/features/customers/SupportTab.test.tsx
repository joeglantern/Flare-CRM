/**
 * The support tab reaches into a system we do not own, so what is tested here is the friction: it
 * asks nobody's stack anything until told to, it says on screen that the customer's own audit log
 * records what we did, and neither action fires until the person's own address has been typed out.
 *
 * The failure this guards against is quiet: the wrong row, and somebody else's authenticator is gone.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupportUser } from '@crm/shared';
import { ToastHost } from '@crm/ui';
import { renderWithQuery, stubFetch, type FetchStub } from '@/test/render';
import { SupportTab } from './SupportTab';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const LIST = `/api/v1/customers/${CUSTOMER_ID}/support/list-users`;
const RESET = `/api/v1/customers/${CUSTOMER_ID}/support/reset-two-factor`;
const REVOKE = `/api/v1/customers/${CUSTOMER_ID}/support/revoke-sessions`;

const jane: SupportUser = {
  id: 'usr_1',
  name: 'Jane Doe',
  email: 'jane@acme.example',
  role: 'admin',
  isActive: true,
  twoFactorEnabled: true,
  lastSeenAt: '2026-09-10T08:00:00.000Z',
};

let fetchStub: FetchStub | null = null;

function renderTab(connected = true) {
  fetchStub = stubFetch({
    [`POST ${LIST}`]: { stackId: 'stk_abcdefghijklmnopqrst', users: [jane] },
    [`POST ${RESET}`]: { ok: true, message: 'They can enrol again at their next sign-in.' },
    [`POST ${REVOKE}`]: { ok: true, message: 'They have been signed out everywhere.' },
  });
  return renderWithQuery(
    <SupportTab customerId={CUSTOMER_ID} customerName="Acme Ltd" connected={connected} />,
  );
}

/** Asks the stack for its users and waits for Jane's row. */
async function listUsers() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Ask their stack' }));
  await screen.findByText('jane@acme.example');
  return user;
}

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
});

describe('the support tab', () => {
  it('says on screen that the customer sees what we did, in their own audit log', () => {
    renderTab();
    expect(screen.getByText(/audit log that names us and says what we did/)).toBeVisible();
    expect(screen.getByText(/Nothing here reads any of their business data/)).toBeVisible();
  });

  it('asks their stack nothing until it is told to', () => {
    renderTab();
    expect(screen.getByText('Nothing has been asked yet')).toBeVisible();
    expect(fetchStub?.requests).toHaveLength(0);
  });

  it('lists their people once asked', async () => {
    renderTab();
    await listUsers();

    expect(fetchStub?.requests.filter((r) => r.path === LIST)).toHaveLength(1);
    const row = within(screen.getByRole('row', { name: /Jane Doe/ }));
    expect(row.getByText('admin')).toBeVisible();
  });

  it('will not ask an offline stack anything', () => {
    renderTab(false);
    expect(screen.getByRole('button', { name: 'Ask their stack' })).toBeDisabled();
    expect(screen.getByText(/whoever is locked out stays locked out/)).toBeVisible();
  });

  it('holds the reset until the person’s own address is typed out', async () => {
    renderTab();
    const user = await listUsers();

    await user.click(screen.getByRole('button', { name: 'Reset two-factor' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Jane Doe \(jane@acme\.example\) at Acme Ltd/)).toBeVisible();
    expect(dialog.getByText(/recorded in that customer's own audit log, naming us/)).toBeVisible();

    const confirm = dialog.getByRole('button', { name: 'Reset their two-factor' });
    expect(confirm).toBeDisabled();

    await user.type(dialog.getByRole('textbox'), 'jane@acme.example');
    await waitFor(() => {
      expect(confirm).toBeEnabled();
    });
    await user.click(confirm);

    await waitFor(() => {
      expect(fetchStub?.lastBody('POST', RESET)).toEqual({ email: 'jane@acme.example' });
    });
  });

  it('does not accept a near miss of the address', async () => {
    renderTab();
    const user = await listUsers();

    await user.click(screen.getByRole('button', { name: 'Reset two-factor' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox'), 'jane@acme.exampl');

    expect(dialog.getByRole('button', { name: 'Reset their two-factor' })).toBeDisabled();
    expect(fetchStub?.requests.some((r) => r.path === RESET)).toBe(false);
  });

  it('names the person and the customer before ending their sessions', async () => {
    renderTab();
    const user = await listUsers();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Jane Doe \(jane@acme\.example\) at Acme Ltd/)).toBeVisible();
    expect(dialog.getByText(/including work in progress/)).toBeVisible();

    await user.type(dialog.getByRole('textbox'), 'jane@acme.example');
    await user.click(dialog.getByRole('button', { name: 'Sign them out' }));

    await waitFor(() => {
      expect(fetchStub?.lastBody('POST', REVOKE)).toEqual({ email: 'jane@acme.example' });
    });
  });

  it('repeats the stack’s own refusal rather than a failure of our own', async () => {
    fetchStub = stubFetch({
      [`POST ${LIST}`]: { stackId: 'stk_abcdefghijklmnopqrst', users: [jane] },
    });
    // The toast is where a refusal is reported, and the host that draws it lives in the shell.
    renderWithQuery(
      <>
        <SupportTab customerId={CUSTOMER_ID} customerName="Acme Ltd" connected />
        <ToastHost />
      </>,
    );
    const user = await listUsers();
    // Their stack answering "no" arrives as a 409 with its own sentence in it, and that sentence is
    // the only thing that explains why, so it has to survive to the screen.
    const stubbed = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(RESET)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'CONFLICT',
                message: 'Nobody here uses that email address',
                requestId: 'test',
              },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return stubbed(input, init);
    });

    await user.click(screen.getByRole('button', { name: 'Reset two-factor' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox'), 'jane@acme.example');
    await user.click(dialog.getByRole('button', { name: 'Reset their two-factor' }));

    expect(await screen.findByText('Nobody here uses that email address')).toBeVisible();
    expect(screen.getByText(/Nothing was changed/)).toBeVisible();
    globalThis.fetch = stubbed;
  });

  it('does not offer to reset an authenticator that person never set up', async () => {
    fetchStub = stubFetch({
      [`POST ${LIST}`]: {
        stackId: 'stk_abcdefghijklmnopqrst',
        users: [{ ...jane, twoFactorEnabled: false }],
      },
    });
    renderWithQuery(<SupportTab customerId={CUSTOMER_ID} customerName="Acme Ltd" connected />);
    await listUsers();

    expect(screen.getByRole('button', { name: 'Reset two-factor' })).toBeDisabled();
  });
});
