import { BarChart3, Bell, ClipboardCopy, FileSpreadsheet, Inbox } from 'lucide-react';
import type { Chapter } from '../types';

export const inbox: Chapter = {
  id: 'inbox',
  title: 'Inbox',
  icon: Inbox,
  group: 'Messaging',
  feature: 'messaging',
  permission: 'chat:read',
  summary: 'WhatsApp conversations, the 24 hour rule, templates, and handing threads over.',
  sections: [
    {
      id: 'conversations',
      heading: 'Conversations',
      blocks: [
        {
          type: 'p',
          text: 'The inbox is a shared mailbox for WhatsApp. Threads on the left, the conversation in the middle, and who you are talking to on the right, with their record in the CRM.',
        },
        {
          type: 'figure',
          name: 'inbox',
          alt: 'The inbox with the conversation list, thread and contact panel',
          caption: 'The inbox.',
        },
        {
          type: 'p',
          text: 'A message from a number the CRM recognises attaches itself to that contact automatically, so their calls, notes and messages share one timeline.',
        },
      ],
    },
    {
      id: 'window',
      heading: 'The 24 hour rule',
      blocks: [
        {
          type: 'diagram',
          name: 'WhatsAppWindow',
          caption: 'Replying freely is only allowed for 24 hours after their last message.',
        },
        {
          type: 'p',
          text: 'WhatsApp allows a business to write whatever it likes for 24 hours after a customer’s last message. After that, only message templates approved by WhatsApp may be sent, until the customer writes again.',
        },
        {
          type: 'p',
          text: 'The CRM shows how long is left. When the window closes, the message box is replaced by the template picker rather than letting you type something that would be rejected.',
        },
        {
          type: 'figure',
          name: 'template-picker',
          alt: 'The template picker shown when the window has closed',
          caption: 'Outside the window, only templates.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'This is a WhatsApp rule, not a CRM one. Templates are created and approved in your WhatsApp Business account, then recorded in Settings, Channels so they can be picked here.',
        },
      ],
    },
    {
      id: 'assign-close',
      heading: 'Assigning and closing',
      permission: 'chat:close',
      blocks: [
        {
          type: 'p',
          text: 'Assign a conversation to yourself or a colleague so two people do not answer the same customer. Close it when the matter is finished; a new message reopens it.',
        },
        { type: 'related', ids: ['contacts', 'settings', 'notes-files'] },
      ],
    },
  ],
};

export const reports: Chapter = {
  id: 'reports',
  title: 'Reports',
  icon: BarChart3,
  group: 'Reports and data',
  feature: 'reports',
  permission: 'report:view_own',
  summary: 'Call activity, missed calls, pipeline, conversion and forecast.',
  sections: [
    {
      id: 'range-and-scope',
      heading: 'The date range and whose numbers these are',
      blocks: [
        {
          type: 'p',
          text: 'One date range applies to every report on the screen. The header says whose figures you are looking at: your own, your team’s, or the whole company. That follows your role and is decided by the server, so a report can never show more than you are allowed to see.',
        },
      ],
    },
    {
      id: 'calls',
      heading: 'Call reports',
      feature: 'telephony',
      blocks: [
        {
          type: 'p',
          text: 'The summary counts calls by day, by hour of the day and by outcome, which is how you find the hour you are understaffed.',
        },
        {
          type: 'figure',
          name: 'report-calls-summary',
          alt: 'The call summary report with charts by day, hour and outcome',
          caption: 'Call activity.',
        },
        {
          type: 'p',
          text: 'The per-agent report compares people: how many calls, how long, how many answered. The missed call report lists calls nobody returned, with how many times each number tried.',
        },
        { type: 'figure', name: 'report-agents', alt: 'The per agent call report' },
        { type: 'figure', name: 'report-missed', alt: 'The missed calls report' },
      ],
    },
    {
      id: 'pipeline',
      heading: 'Pipeline reports',
      feature: 'deals',
      blocks: [
        {
          type: 'p',
          text: 'The pipeline summary is what is open, by stage and by value. The conversion funnel shows where deals are lost, and the forecast weights each deal by its stage probability over the coming months.',
        },
        { type: 'figure', name: 'report-pipeline-summary', alt: 'The pipeline summary report' },
        { type: 'figure', name: 'report-conversion', alt: 'The conversion funnel report' },
        { type: 'figure', name: 'report-forecast', alt: 'The forecast report' },
        {
          type: 'callout',
          tone: 'info',
          text: 'The forecast is by month rather than by the date range at the top of the screen, so its own control sets how far ahead to look.',
        },
        { type: 'related', ids: ['deals', 'calls', 'import-export'] },
      ],
    },
  ],
};

export const importExport: Chapter = {
  id: 'import-export',
  title: 'Import and export',
  icon: FileSpreadsheet,
  group: 'Reports and data',
  summary: 'Bringing a spreadsheet in, and getting your data out.',
  sections: [
    {
      id: 'exporting',
      heading: 'Exporting',
      feature: 'exports',
      blocks: [
        {
          type: 'p',
          text: 'Most lists have an Export button that downloads what you are looking at, filters and all, as a CSV file you can open in Excel or Sheets. Contacts, companies, leads, deals, tasks and calls can all be exported.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Exports are recorded in the audit log with who took them and when, because an export is a copy of company data leaving the system.',
        },
      ],
    },
    {
      id: 'importing',
      heading: 'Importing a spreadsheet',
      feature: 'imports',
      permission: 'contact:import',
      blocks: [
        {
          type: 'p',
          text: 'Contacts, companies and leads can be imported from CSV. Save your spreadsheet as CSV first; the first row must be the column names.',
        },
        {
          type: 'steps',
          items: [
            'Choose what you are importing and pick the file. The CRM reads the headings without uploading anything yet.',
            'Match each column in your file to a field in the CRM. Anything left unmatched is ignored.',
            'Say what to do about people who already exist: skip them or update them.',
            'Start the import. It runs in the background and reports how many rows were added, updated and rejected.',
          ],
        },
        {
          type: 'figure',
          name: 'import-wizard-1',
          alt: 'Step one of the import wizard: choosing a file',
        },
        { type: 'figure', name: 'import-wizard-2', alt: 'Step two: matching columns to fields' },
        { type: 'figure', name: 'import-wizard-3', alt: 'Step three: the result summary' },
        {
          type: 'callout',
          tone: 'warning',
          text: 'Phone numbers are normalised on the way in using your default country, so 0722123456 becomes +254722123456. A row with a number the CRM cannot make sense of is rejected and listed, rather than being saved wrong.',
        },
        { type: 'related', ids: ['contacts', 'settings'] },
      ],
    },
  ],
};

export const notifications: Chapter = {
  id: 'notifications',
  title: 'Notifications',
  icon: Bell,
  group: 'Reports and data',
  permission: 'notification:manage_own',
  summary: 'What the CRM tells you about, and how to change it.',
  sections: [
    {
      id: 'the-bell',
      heading: 'The bell',
      blocks: [
        {
          type: 'p',
          text: 'The bell in the top bar carries a count of what you have not read. Notifications arrive as things happen: a task assigned to you, a reminder falling due, a deal moving, a message arriving.',
        },
        { type: 'figure', name: 'notifications', alt: 'The notification centre' },
      ],
    },
    {
      id: 'preferences',
      heading: 'Choosing what you are told',
      blocks: [
        {
          type: 'p',
          text: 'Each kind of notification can be switched on or off separately for in-app and for email. Turning off email for deal changes while keeping it for task reminders is a reasonable setup.',
        },
        { type: 'figure', name: 'notification-prefs', alt: 'Notification preferences by type' },
        { type: 'related', ids: ['tasks', 'getting-started'] },
      ],
    },
  ],
};

export const webForms: Chapter = {
  id: 'web-forms',
  title: 'Web forms',
  icon: ClipboardCopy,
  group: 'Reports and data',
  feature: 'webforms',
  permission: 'webform:manage',
  summary: 'Putting an enquiry form on your website that creates leads here.',
  sections: [
    {
      id: 'creating',
      heading: 'Creating a form',
      blocks: [
        {
          type: 'p',
          text: 'Settings, Web forms creates a form, chooses which fields it asks for, and decides who owns the leads it produces.',
        },
        { type: 'figure', name: 'settings-forms', alt: 'The web forms settings section' },
        {
          type: 'p',
          text: 'The CRM gives you a snippet to paste into your website. A submission becomes a lead here and notifies the owner.',
        },
      ],
    },
    {
      id: 'origins',
      heading: 'Keeping it from being abused',
      blocks: [
        {
          type: 'p',
          text: 'List the websites allowed to use the form. A submission from anywhere else is refused, which stops someone copying your form and filling your CRM with rubbish.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Forms are also rate limited and carry a hidden field that automated spam fills in and people never see. Both happen without any configuration.',
        },
        { type: 'related', ids: ['leads', 'settings'] },
      ],
    },
  ],
};
