import { BadgeCheck, Cog, HardDriveDownload, ScrollText, ShieldCheck, Users } from 'lucide-react';
import type { Chapter } from '../types';

export const settings: Chapter = {
  id: 'settings',
  title: 'Settings',
  icon: Cog,
  group: 'Administration',
  permission: 'settings:read',
  summary: 'Every setting that changes how the CRM behaves for everyone in the workspace.',
  sections: [
    {
      id: 'general',
      heading: 'General',
      blocks: [
        {
          type: 'p',
          text: 'The default country decides how a typed phone number is understood: with Kenya set, 0722123456 becomes +254722123456. The currency is what money is shown in throughout.',
        },
        {
          type: 'p',
          text: 'Agent visibility decides how much of the workspace an agent sees: only their own records, their whole team’s, or everything. It applies everywhere at once, including reports and search.',
        },
        {
          type: 'diagram',
          name: 'RolesVisibility',
          caption: 'What each role can see, and the setting that widens it for agents.',
        },
        { type: 'figure', name: 'settings-general', alt: 'The general settings section' },
      ],
    },
    {
      id: 'telephony',
      heading: 'Telephony',
      feature: 'telephony',
      blocks: [
        {
          type: 'p',
          text: 'The connection panel shows whether the CRM is talking to your phone system, since when, and when it last heard anything.',
        },
        {
          type: 'p',
          text: 'Dial rules translate a stored number into what your phone system expects: whether to strip the plus, what prefix to add for an outside line, and how many digits an internal extension has.',
        },
        {
          type: 'p',
          text: 'Popup options decide whether internal calls pop, whether answering opens the caller’s page, and whether ending a call offers to create a follow-up.',
        },
        { type: 'figure', name: 'settings-telephony', alt: 'The telephony settings section' },
      ],
    },
    {
      id: 'recording',
      heading: 'Recording',
      feature: 'recordings',
      blocks: [
        {
          type: 'p',
          text: 'The consent text agents read out, whether agents may play back their own calls, and how long recordings are kept before deletion.',
        },
        { type: 'figure', name: 'settings-recording', alt: 'The recording settings section' },
      ],
    },
    {
      id: 'matching',
      heading: 'Number matching',
      feature: 'telephony',
      blocks: [
        {
          type: 'p',
          text: 'Some phone systems present numbers without a country code. Suffix matching lets the CRM match on the last several digits so those calls still find the right contact. It is off by default because a short suffix can match the wrong person.',
        },
      ],
    },
    {
      id: 'security-settings',
      heading: 'Security',
      blocks: [
        {
          type: 'p',
          text: 'Whether two-factor is required of administrators and managers, or of everyone, and how long a session may sit idle before it is signed out.',
        },
        { type: 'figure', name: 'settings-security', alt: 'The security settings section' },
      ],
    },
    {
      id: 'retention-settings',
      heading: 'Data retention',
      blocks: [
        {
          type: 'p',
          text: 'How long deleted records stay recoverable, how long phone system events are kept, and how long raw message payloads are held before being stripped.',
        },
        {
          type: 'callout',
          tone: 'danger',
          text: 'Shortening a retention period takes effect at the next nightly run, which can delete a lot of data at once. The CRM warns before saving; read the warning.',
        },
      ],
    },
    {
      id: 'lists',
      heading: 'Custom fields, pipelines, outcomes and channels',
      blocks: [
        {
          type: 'p',
          text: 'Custom fields add your own fields to contacts, companies, deals and leads, and they can be imported and put on web forms like any other field.',
        },
        {
          type: 'p',
          text: 'Pipelines define deal stages. Call outcomes define what agents pick after a call. Channels hold the WhatsApp connection and its approved templates.',
        },
        { type: 'figure', name: 'settings-fields', alt: 'The custom fields settings section' },
        { type: 'figure', name: 'settings-channels', alt: 'The channels settings section' },
        { type: 'related', ids: ['users-roles', 'your-plan', 'backups-retention'] },
      ],
    },
  ],
};

export const usersRoles: Chapter = {
  id: 'users-roles',
  title: 'Users, teams and roles',
  icon: Users,
  group: 'Administration',
  permission: 'team:read',
  summary: 'Adding colleagues, what each role may do, and how teams shape what people see.',
  sections: [
    {
      id: 'adding',
      heading: 'Adding someone',
      permission: 'user:create',
      blocks: [
        {
          type: 'p',
          text: 'Settings, Users adds a colleague. They receive an email with a link to set their own password; you never type a password for them.',
        },
        {
          type: 'steps',
          items: [
            'Enter their name and work email address.',
            'Choose a role: agent, manager or administrator.',
            'Set their phone extension, if they will be taking calls. Without one, dialling and call matching do not work for them.',
            'Put them in a team if managers should see their work.',
          ],
        },
        { type: 'figure', name: 'settings-users', alt: 'The users settings section' },
      ],
    },
    {
      id: 'roles',
      heading: 'What each role may do',
      blocks: [
        {
          type: 'p',
          text: 'Three roles. An <em>agent</em> does the daily work on their own records. A <em>manager</em> does the same across their team and can see team reports and the live call board. An <em>administrator</em> can do everything, including changing settings, adding people and reading the audit log.',
        },
        {
          type: 'permissions',
          roles: ['agent', 'manager', 'admin'],
        },
      ],
    },
    {
      id: 'lost-authenticator',
      heading: 'When someone loses their phone',
      permission: 'user:update',
      blocks: [
        {
          type: 'p',
          text: 'They should try a backup code first: one of the codes saved during setup signs them in, and they can then set the authenticator up again themselves.',
        },
        {
          type: 'p',
          text: 'If those are gone too, open Settings, Users, find them in the list and choose <em>Reset two-factor</em> from the row menu. They are signed out everywhere and asked to enrol again the next time they sign in.',
        },
        {
          type: 'p',
          text: 'They are emailed as soon as you do it, naming you, because a second factor that stops working with no explanation looks like a broken account or a break-in. Tell them to sign in with their password as usual: they will be shown a new QR code to scan rather than a box asking for a code, and their old authenticator entry can be deleted.',
        },
        {
          type: 'callout',
          tone: 'warning',
          text: 'Anyone who can do this can hand someone else a way in. Be certain who you are talking to before you reset it, and know that the reset is recorded in the audit log with your name against it.',
        },
      ],
    },
    {
      id: 'deactivating',
      heading: 'When someone leaves',
      permission: 'user:update',
      blocks: [
        {
          type: 'p',
          text: 'Deactivate them rather than deleting. They can no longer sign in and every session is ended immediately, while their calls, notes and deals stay where they are and keep their name on them.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'A deactivated user does not count towards the number of users your plan allows, so deactivating frees a place for their replacement.',
        },
        { type: 'related', ids: ['security', 'your-plan', 'audit-log'] },
      ],
    },
  ],
};

export const security: Chapter = {
  id: 'security',
  title: 'Security',
  icon: ShieldCheck,
  group: 'Administration',
  summary: 'Sessions, passwords, two-factor and what is recorded.',
  sections: [
    {
      id: 'sessions',
      heading: 'Sessions and idle timeout',
      blocks: [
        {
          type: 'p',
          text: 'Signing in creates a session that lasts twelve hours. Leaving the CRM untouched for longer than the idle timeout signs you out and says so, rather than failing silently on your next click.',
        },
        {
          type: 'p',
          text: 'An administrator can end all of someone’s sessions at once from Settings, Users, which is what to do the moment a laptop goes missing.',
        },
      ],
    },
    {
      id: 'passwords',
      heading: 'Passwords',
      blocks: [
        {
          type: 'p',
          text: 'Passwords must be at least twelve characters and are checked against a list of passwords known to have been leaked elsewhere. Nobody, including an administrator, can see your password.',
        },
      ],
    },
    {
      id: 'provider-support',
      heading: 'What the people who run this software can do',
      blocks: [
        {
          type: 'p',
          text: 'If your only administrator is locked out, whoever provides your CRM can help: they can list who is able to sign in here, clear one person’s two-factor so that person can set an authenticator up again, and end one person’s sessions. That list is the whole list.',
        },
        {
          type: 'p',
          text: 'They cannot read your contacts, calls, messages or deals through it, cannot create an account, and cannot change what anybody is allowed to do.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Every one of those actions is written into your own audit log, naming the provider and the reason given, at the moment it happens. If it is not in your audit log, it did not happen.',
        },
      ],
    },
    {
      id: 'what-is-recorded',
      heading: 'What is recorded about you',
      blocks: [
        {
          type: 'p',
          text: 'Signing in, failing to sign in, changing a setting, exporting data, listening to a recording, and being refused something you lack permission for: all are recorded with your name, the time and your address. The record cannot be edited or deleted by anyone, including administrators.',
        },
        { type: 'related', ids: ['audit-log', 'users-roles', 'getting-started'] },
      ],
    },
  ],
};

export const backupsRetention: Chapter = {
  id: 'backups-retention',
  title: 'Backups and retention',
  icon: HardDriveDownload,
  group: 'Administration',
  permission: 'settings:read',
  summary: 'What is backed up, how long things are kept, and how to get a copy.',
  sections: [
    {
      id: 'what-happens',
      heading: 'What happens automatically',
      blocks: [
        {
          type: 'diagram',
          name: 'BackupRetentionTimeline',
          caption:
            'The nightly cycle: a snapshot is taken, expired data is removed, old snapshots are trimmed.',
        },
        {
          type: 'p',
          text: 'A full snapshot of the database is taken every night at half past two, and the most recent fourteen are kept. Separately, a nightly job removes data whose retention period has passed.',
        },
      ],
    },
    {
      id: 'downloading',
      heading: 'Downloading a snapshot',
      feature: 'backups',
      permission: 'settings:manage',
      blocks: [
        {
          type: 'p',
          text: 'Settings, Backups lists the snapshots and lets you download one, or upload one carried from another server.',
        },
        { type: 'figure', name: 'settings-backups', alt: 'The backups settings section' },
        {
          type: 'callout',
          tone: 'warning',
          text: 'There is deliberately no restore button. Replacing the database while people are using it breaks whatever they are in the middle of, so restoring is done by whoever runs your server, with the CRM stopped.',
        },
      ],
    },
    {
      id: 'deleted-records',
      heading: 'Getting a deleted record back',
      blocks: [
        {
          type: 'p',
          text: 'Deleting a contact, company or deal hides it rather than destroying it, and it can be restored until the purge period passes. After that it exists only in a snapshot.',
        },
        { type: 'related', ids: ['settings', 'recordings', 'troubleshooting'] },
      ],
    },
  ],
};

export const auditLog: Chapter = {
  id: 'audit-log',
  title: 'Audit log',
  icon: ScrollText,
  group: 'Administration',
  permission: 'audit:read',
  summary: 'Who did what, when, and from where.',
  sections: [
    {
      id: 'reading',
      heading: 'Reading the log',
      blocks: [
        {
          type: 'p',
          text: 'Settings, Audit log lists every recorded action, newest first, and filters by person, by kind of action or by a particular record.',
        },
        { type: 'figure', name: 'settings-audit', alt: 'The audit log with filters' },
        {
          type: 'callout',
          tone: 'info',
          text: 'The log is append-only. The database itself refuses to change or remove an entry, so it stays trustworthy even against someone with administrator access.',
        },
      ],
    },
    {
      id: 'change-details',
      heading: 'Seeing what changed',
      feature: 'audit_diff',
      blocks: [
        {
          type: 'p',
          text: 'Where an action altered values, the entry shows exactly what they were before and after, so a settings change or a role change can be reviewed rather than guessed at.',
        },
        { type: 'related', ids: ['security', 'recordings'] },
      ],
    },
  ],
};

export const yourPlan: Chapter = {
  id: 'your-plan',
  title: 'Your plan',
  icon: BadgeCheck,
  group: 'Administration',
  permission: 'settings:read',
  summary: 'What your subscription includes, what it limits, and what happens at the edges.',
  sections: [
    {
      id: 'what-it-controls',
      heading: 'What a plan controls',
      blocks: [
        {
          type: 'p',
          text: 'Settings, Your plan lists which parts of the CRM your subscription includes, how much of each limit you are using, and who to contact to change any of it.',
        },
        { type: 'figure', name: 'settings-plan', alt: 'The Your plan settings section' },
        {
          type: 'diagram',
          name: 'EntitlementsFlow',
          caption: 'A change made by your provider reaches your screen straight away.',
        },
      ],
    },
    {
      id: 'limits',
      heading: 'Limits and what happens when you reach one',
      blocks: [
        {
          type: 'table',
          headers: ['Limit', 'What happens at the ceiling'],
          rows: [
            [
              'Active users',
              'Adding or reactivating a user is refused. Deactivating someone frees a place.',
            ],
            [
              'Storage',
              'New attachments, recordings and uploaded snapshots are refused. Nothing existing is deleted.',
            ],
            [
              'Recording retention',
              'Your own retention setting cannot be set above the plan ceiling.',
            ],
            ['Messaging channels', 'An extra channel cannot be created or activated.'],
            ['Pipelines', 'An extra pipeline cannot be created.'],
          ],
        },
        {
          type: 'p',
          text: 'A refusal always says which limit was reached, what is in use and what the ceiling is, so it is clear whether to free something up or ask for more.',
        },
      ],
    },
    {
      id: 'expiry',
      heading: 'If the plan expires',
      blocks: [
        {
          type: 'p',
          text: 'An expired plan makes the CRM read only. Everyone can still sign in and look at everything; nothing can be changed until it is renewed. Nothing is deleted and no data is lost.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Incoming calls, WhatsApp messages and web form submissions are still captured while a plan is expired, so no business is missed during a renewal.',
        },
        { type: 'related', ids: ['settings', 'users-roles', 'troubleshooting'] },
      ],
    },
  ],
};
