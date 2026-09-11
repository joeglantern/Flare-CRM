/**
 * The owners screen is where somebody who is locked out of the console gets let back in, so the
 * things worth testing are that each action says what it costs before it happens and that confirming
 * it reaches the endpoint the enrolment screen promises exists.
 *
 * Losing both authenticators loses the console, which is the failure these actions exist to prevent
 * and also the one a careless click would cause.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Me, Owner } from '@/lib/types';
import { renderWithRouter, stubFetch, type FetchStub } from '@/test/render';
import { OwnersScreen } from './OwnersScreen';

const ME_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const me: Me = {
  id: ME_ID,
  name: 'Liban',
  email: 'liban@example.com',
  role: 'owner',
  twoFactorEnabled: true,
  permissions: [],
};

const liban: Owner = {
  id: ME_ID,
  name: 'Liban',
  email: 'liban@example.com',
  role: 'owner',
  isActive: true,
  twoFactorEnabled: true,
  lastSeenAt: '2026-09-10T09:00:00.000Z',
};

const amina: Owner = {
  id: OTHER_ID,
  name: 'Amina',
  email: 'amina@example.com',
  role: 'owner',
  isActive: true,
  twoFactorEnabled: true,
  lastSeenAt: '2026-09-09T09:00:00.000Z',
};

const owners: Owner[] = [liban, amina];

let fetchStub: FetchStub | null = null;

function renderScreen(rows: Owner[] = owners) {
  fetchStub = stubFetch({
    'GET /api/v1/me': me,
    'GET /api/v1/owners': rows,
    [`POST /api/v1/owners/${OTHER_ID}/two-factor/reset`]: { ok: true },
    [`POST /api/v1/owners/${OTHER_ID}/revoke-sessions`]: { ok: true },
    [`POST /api/v1/owners/${OTHER_ID}/deactivate`]: { ok: true },
    [`POST /api/v1/owners/${OTHER_ID}/reactivate`]: { ok: true },
    [`POST /api/v1/owners/${OTHER_ID}/role`]: { ...amina, role: 'support' },
  });
  return renderWithRouter(<OwnersScreen />);
}

/** Opens the row menu for one owner and picks an item from it. */
async function pick(ownerName: string, item: string | RegExp) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Actions for ${ownerName}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
  return user;
}

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
});

describe('the owners screen', () => {
  it('spells out what resetting two-factor costs before it happens', async () => {
    renderScreen();
    await pick('Amina', /Reset two-factor/);

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Amina will be asked to set up an authenticator again/)).toBeVisible();
    expect(dialog.getByText(/backup codes stop working/)).toBeVisible();
    expect(dialog.getByText(/signed out everywhere immediately/)).toBeVisible();
    expect(dialog.getByText(/only do this when you are sure who you are talking to/)).toBeVisible();
    // Nothing has been sent yet: the dialog is a question, not a receipt.
    expect(fetchStub?.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('posts the reset only after it is confirmed', async () => {
    renderScreen();
    const user = await pick('Amina', /Reset two-factor/);

    await user.click(await screen.findByRole('button', { name: 'Reset two-factor' }));

    await waitFor(() => {
      expect(
        fetchStub?.requests.some(
          (r) => r.method === 'POST' && r.path === `/api/v1/owners/${OTHER_ID}/two-factor/reset`,
        ),
      ).toBe(true);
    });
  });

  it('sends a password link, and says that nobody sees the password', async () => {
    renderScreen();
    const user = await pick('Amina', /Send a password link/);

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/ever sees or sets it/)).toBeVisible();
    // The one thing somebody might assume wrongly: that this also clears their authenticator.
    expect(dialog.getByText(/authenticator is untouched/)).toBeVisible();

    await user.click(await screen.findByRole('button', { name: 'Send the link' }));

    await waitFor(() => {
      expect(
        fetchStub?.requests.some(
          (r) => r.method === 'POST' && r.path === `/api/v1/owners/${OTHER_ID}/password-reset`,
        ),
      ).toBe(true);
    });
  });

  it('sends nothing when the confirmation is dismissed', async () => {
    renderScreen();
    const user = await pick('Amina', /Sign out everywhere/);

    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(fetchStub?.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('says plainly that ending sessions changes nothing else', async () => {
    renderScreen();
    await pick('Amina', /Sign out everywhere/);

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Every session on every device ends immediately/)).toBeVisible();
    expect(
      dialog.getByText(/their password, authenticator and access are untouched/),
    ).toBeVisible();
  });

  it('offers to reactivate a deactivated owner, and warns that it does not replace their authenticator', async () => {
    renderScreen([liban, { ...amina, isActive: false }]);
    const user = await pick('Amina', 'Reactivate');

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/regain every permission in this console/)).toBeVisible();
    expect(dialog.getByText(/reactivating does not replace it/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => {
      expect(
        fetchStub?.requests.some(
          (r) => r.method === 'POST' && r.path === `/api/v1/owners/${OTHER_ID}/reactivate`,
        ),
      ).toBe(true);
    });
  });

  it('says what narrowing somebody to support costs, then posts it', async () => {
    renderScreen();
    const user = await pick('Amina', 'Narrow to support');

    const dialog = within(await screen.findByRole('dialog'));
    expect(
      dialog.getByText(/can no longer change plans, prices, entitlements or accounts/),
    ).toBeVisible();
    expect(dialog.getByText(/signed out now/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Narrow to support' }));

    await waitFor(() => {
      expect(fetchStub?.lastBody('POST', `/api/v1/owners/${OTHER_ID}/role`)).toEqual({
        role: 'support',
      });
    });
  });

  it('will not let somebody change their own role', async () => {
    renderScreen();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actions for Liban' }));

    expect(await screen.findByRole('menuitem', { name: 'Narrow to support' })).toBeDisabled();
  });

  it('will not let an owner deactivate their own account', async () => {
    renderScreen();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actions for Liban' }));

    expect(await screen.findByRole('menuitem', { name: 'Deactivate' })).toBeDisabled();
  });

  it('does not offer to reset an authenticator nobody has set up', async () => {
    renderScreen([liban, { ...amina, twoFactorEnabled: false }]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actions for Amina' }));

    expect(await screen.findByRole('menuitem', { name: /Reset two-factor/ })).toBeDisabled();
  });
});
