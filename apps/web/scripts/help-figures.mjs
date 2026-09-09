/**
 * What the manual's screenshots show, and how to get the screen into that state.
 *
 * `route` is where to go; `selector` narrows the shot to one element; `actions` drives the app
 * into a state a plain visit would not reach (a dialog open, a filter applied). `mock` intercepts
 * an API response, used only for states that cannot be produced on demand, such as a disconnected
 * phone system. The result is still a picture of the real component, not a drawing of one.
 *
 * Names must match the `figure` blocks in src/features/help/content/chapters/*.
 */

/** @typedef {{ chapter: string, name: string, route: string, selector?: string, viewport?: 'desktop'|'mobile', actions?: (page: import('playwright').Page) => Promise<void>, mock?: Record<string, unknown> }} Figure */

const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
};

const openDialog = (name) => async (page) => {
  await page.getByRole('button', { name }).first().click();
  await page.waitForTimeout(500);
};

/** @type {Figure[]} */
export const FIGURES = [
  // Getting started
  { chapter: 'getting-started', name: 'sign-in', route: '/sign-in', anonymous: true },
  { chapter: 'getting-started', name: 'profile', route: '/profile' },
  {
    chapter: 'getting-started',
    name: 'mobile-nav',
    route: '/home',
    viewport: 'mobile',
    actions: async (page) => {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.waitForTimeout(400);
    },
  },

  // Home
  { chapter: 'home', name: 'home', route: '/home' },
  { chapter: 'home', name: 'home-manager', route: '/home' },

  // Contacts
  { chapter: 'contacts', name: 'contacts-list', route: '/contacts' },
  {
    chapter: 'contacts',
    name: 'contacts-bulk',
    route: '/contacts',
    actions: async (page) => {
      await page
        .getByRole('checkbox')
        .nth(1)
        .click()
        .catch(() => undefined);
      await page.waitForTimeout(300);
    },
  },
  { chapter: 'contacts', name: 'contact-detail', route: '/contacts', follow: 'first-row' },

  // Companies
  { chapter: 'companies', name: 'company-detail', route: '/companies', follow: 'first-row' },

  // Leads
  { chapter: 'leads', name: 'leads-list', route: '/leads' },
  {
    chapter: 'leads',
    name: 'convert-lead',
    route: '/leads',
    follow: 'first-row',
    actions: openDialog('Convert'),
  },

  // Deals
  { chapter: 'deals', name: 'deals-board', route: '/deals' },
  { chapter: 'deals', name: 'lost-reason', route: '/deals', actions: openDialog('Mark lost') },

  // Tasks
  { chapter: 'tasks', name: 'tasks-list', route: '/tasks' },
  { chapter: 'tasks', name: 'tasks-calendar', route: '/tasks?view=calendar' },

  // Notes and files
  {
    chapter: 'notes-files',
    name: 'notes-panel',
    route: '/contacts',
    follow: 'first-row',
    actions: async (page) => {
      await page
        .getByRole('tab', { name: 'Notes' })
        .click()
        .catch(() => undefined);
      await page.waitForTimeout(400);
    },
  },

  // Calls
  { chapter: 'calls', name: 'calls-list', route: '/calls' },
  { chapter: 'calls', name: 'call-detail', route: '/calls', follow: 'first-row' },
  { chapter: 'calls', name: 'missed-calls', route: '/calls/missed' },
  { chapter: 'calls', name: 'dialpad', route: '/calls/dialpad' },
  { chapter: 'calls', name: 'live-calls', route: '/live-calls' },

  // Inbox
  { chapter: 'inbox', name: 'inbox', route: '/inbox' },

  // Reports
  { chapter: 'reports', name: 'report-calls-summary', route: '/reports' },
  { chapter: 'reports', name: 'report-agents', route: '/reports?tab=agents' },
  { chapter: 'reports', name: 'report-missed', route: '/reports?tab=missed' },
  { chapter: 'reports', name: 'report-pipeline-summary', route: '/reports?tab=pipeline' },
  { chapter: 'reports', name: 'report-conversion', route: '/reports?tab=conversion' },
  { chapter: 'reports', name: 'report-forecast', route: '/reports?tab=forecast' },

  // Import and export
  { chapter: 'import-export', name: 'import-wizard-1', route: '/imports' },

  // Notifications
  { chapter: 'notifications', name: 'notifications', route: '/notifications' },

  // Web forms
  { chapter: 'web-forms', name: 'settings-forms', route: '/settings?section=forms' },

  // Settings
  { chapter: 'settings', name: 'settings-general', route: '/settings?section=general' },
  { chapter: 'settings', name: 'settings-telephony', route: '/settings?section=telephony' },
  { chapter: 'settings', name: 'settings-recording', route: '/settings?section=recording' },
  { chapter: 'settings', name: 'settings-security', route: '/settings?section=security' },
  { chapter: 'settings', name: 'settings-fields', route: '/settings?section=fields' },
  { chapter: 'settings', name: 'settings-channels', route: '/settings?section=channels' },

  // Users, backups, audit, plan
  { chapter: 'users-roles', name: 'settings-users', route: '/settings?section=users' },
  { chapter: 'backups-retention', name: 'settings-backups', route: '/settings?section=backups' },
  { chapter: 'audit-log', name: 'settings-audit', route: '/settings?section=audit' },
  { chapter: 'your-plan', name: 'settings-plan', route: '/settings?section=plan' },

  // Search and shortcuts
  {
    chapter: 'search-shortcuts',
    name: 'command-palette',
    route: '/home',
    actions: async (page) => {
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(400);
      await page.keyboard.type('a');
      await page.waitForTimeout(600);
    },
  },

  // Troubleshooting: states that only appear when something is wrong
  {
    chapter: 'troubleshooting',
    name: 'state-banners',
    route: '/home',
    mock: {
      '**/api/v1/cti/status': {
        data: {
          enabled: true,
          connected: false,
          since: null,
          lastEventAt: null,
          eventSource: 'websocket',
          leader: false,
          tokenExpiresAt: null,
          lastReconcileAt: null,
          liveCalls: 0,
        },
      },
    },
  },
  {
    chapter: 'troubleshooting',
    name: 'state-forbidden',
    route: '/settings?section=audit',
    mock: {
      '**/api/v1/audit*': {
        status: 403,
        body: {
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
            details: { required: ['audit:read'] },
            requestId: 'example',
          },
        },
      },
    },
  },
  {
    chapter: 'troubleshooting',
    name: 'state-error',
    route: '/contacts',
    mock: {
      '**/api/v1/contacts*': {
        status: 500,
        body: {
          error: {
            code: 'INTERNAL',
            message: 'Something went wrong',
            requestId: '01a0-example-request-id',
          },
        },
      },
    },
  },
];

export { settle };
