/**
 * Which chapter answers the screen you are on, for the help button in the top bar.
 *
 * Longest matching path wins, so /calls/missed lands on the missed calls section rather than the
 * top of the calls chapter. Settings maps by its section parameter for the same reason.
 */
export interface HelpTarget {
  chapter: string;
  section?: string;
}

const PATHS: { prefix: string; target: HelpTarget }[] = [
  { prefix: '/calls/missed', target: { chapter: 'calls', section: 'missed' } },
  { prefix: '/calls/dialpad', target: { chapter: 'calls', section: 'calling-out' } },
  { prefix: '/calls/', target: { chapter: 'calls', section: 'history' } },
  { prefix: '/calls', target: { chapter: 'calls', section: 'history' } },
  { prefix: '/live-calls', target: { chapter: 'live-calls' } },
  { prefix: '/inbox', target: { chapter: 'inbox' } },
  { prefix: '/contacts', target: { chapter: 'contacts' } },
  { prefix: '/companies', target: { chapter: 'companies' } },
  { prefix: '/leads', target: { chapter: 'leads' } },
  { prefix: '/deals', target: { chapter: 'deals' } },
  { prefix: '/tasks', target: { chapter: 'tasks' } },
  { prefix: '/reports', target: { chapter: 'reports' } },
  { prefix: '/imports', target: { chapter: 'import-export' } },
  { prefix: '/notifications', target: { chapter: 'notifications' } },
  { prefix: '/profile', target: { chapter: 'getting-started', section: 'your-profile' } },
  { prefix: '/home', target: { chapter: 'home' } },
  { prefix: '/help', target: { chapter: 'getting-started' } },
];

/** Settings sections map onto the settings chapter's own sections, or a dedicated chapter. */
const SETTINGS_SECTIONS: Record<string, HelpTarget> = {
  general: { chapter: 'settings', section: 'general' },
  plan: { chapter: 'your-plan' },
  telephony: { chapter: 'settings', section: 'telephony' },
  recording: { chapter: 'settings', section: 'recording' },
  matching: { chapter: 'settings', section: 'matching' },
  security: { chapter: 'settings', section: 'security-settings' },
  retention: { chapter: 'settings', section: 'retention-settings' },
  backups: { chapter: 'backups-retention', section: 'downloading' },
  fields: { chapter: 'settings', section: 'lists' },
  pipelines: { chapter: 'deals', section: 'pipelines-admin' },
  dispositions: { chapter: 'calls', section: 'dispositions' },
  channels: { chapter: 'inbox', section: 'window' },
  forms: { chapter: 'web-forms' },
  users: { chapter: 'users-roles' },
  audit: { chapter: 'audit-log' },
  health: { chapter: 'troubleshooting' },
};

export function chapterForPath(pathname: string, search?: string): HelpTarget {
  if (pathname.startsWith('/settings')) {
    const section = new URLSearchParams(search ?? '').get('section');
    return (section !== null ? SETTINGS_SECTIONS[section] : undefined) ?? { chapter: 'settings' };
  }
  const match = [...PATHS]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((p) => pathname === p.prefix || pathname.startsWith(p.prefix));
  return match?.target ?? { chapter: 'getting-started' };
}
