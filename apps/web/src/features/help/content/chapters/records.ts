import { Building2, Contact, Kanban, SquareCheck, StickyNote, Target } from 'lucide-react';
import type { Chapter } from '../types';

export const contacts: Chapter = {
  id: 'contacts',
  title: 'Contacts',
  icon: Contact,
  group: 'Working with records',
  permission: 'contact:read',
  summary: 'The people you deal with, their numbers, and everything that has happened with them.',
  sections: [
    {
      id: 'the-list',
      heading: 'Finding people',
      blocks: [
        {
          type: 'p',
          text: 'The contacts list searches names, phone numbers and email addresses. Type a phone number in any format you like: 0722 123456, +254722123456 and 722123456 all find the same person.',
        },
        {
          type: 'figure',
          name: 'contacts-list',
          alt: 'The contacts list with filters and columns',
          caption: 'The contacts list.',
        },
        {
          type: 'p',
          text: 'Use <em>Columns</em> to choose what the table shows, and <em>Filters</em> to narrow it down. A filtered view you use often can be saved with <em>Save view</em>, which keeps it in this browser for you alone.',
        },
      ],
    },
    {
      id: 'creating',
      heading: 'Adding a contact',
      permission: 'contact:create',
      blocks: [
        {
          type: 'p',
          text: 'Press <kbd>C</kbd> anywhere, or use New contact. A first name is the only thing strictly required, but a phone number is what makes the contact useful: it is how an incoming call finds them.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'If someone with the same number already exists, the CRM says so before creating a second copy.',
        },
      ],
    },
    {
      id: 'detail',
      heading: 'A contact’s page',
      blocks: [
        {
          type: 'p',
          text: 'Everything about one person in one place: their details, and tabs for their history, deals, tasks, notes, calls, conversations and files.',
        },
        {
          type: 'figure',
          name: 'contact-detail',
          alt: 'A contact page showing the timeline tab',
          caption: 'A contact, with their history.',
        },
        {
          type: 'p',
          text: 'The timeline is the whole story in order: calls, messages, notes, tasks, deal changes. It is the fastest way to catch up before phoning someone back.',
        },
      ],
    },
    {
      id: 'duplicates',
      heading: 'Duplicates and merging',
      permission: 'contact:merge',
      blocks: [
        {
          type: 'p',
          text: 'The same person often ends up entered twice. Open <em>Find duplicates</em> to see likely pairs, then merge them.',
        },
        {
          type: 'callout',
          tone: 'warning',
          text: 'Merging keeps one record and moves the other’s history onto it. The dialog lists exactly which values will be lost before you confirm, because merging cannot be undone.',
        },
      ],
    },
    {
      id: 'bulk',
      heading: 'Changing many at once',
      permission: 'contact:update',
      blocks: [
        {
          type: 'p',
          text: 'Tick rows to select them, and a bar appears with what you can do to all of them: assign an owner, add or remove a tag, mark do not call, or delete.',
        },
        {
          type: 'figure',
          name: 'contacts-bulk',
          alt: 'Rows selected with the bulk action bar showing',
          caption: 'Selected rows, with the actions that apply to all of them.',
        },
      ],
    },
    {
      id: 'do-not-call',
      heading: 'Do not call',
      blocks: [
        {
          type: 'p',
          text: 'Marking a contact do not call stops the CRM dialling them. The number stays, the history stays, and the flag is visible on their page so nobody wonders why dialling is blocked.',
        },
        { type: 'related', ids: ['companies', 'calls', 'import-export'] },
      ],
    },
  ],
};

export const companies: Chapter = {
  id: 'companies',
  title: 'Companies',
  icon: Building2,
  group: 'Working with records',
  permission: 'company:read',
  summary: 'Organisations, the people who work there, and the deals attached to them.',
  sections: [
    {
      id: 'basics',
      heading: 'Companies and their people',
      blocks: [
        {
          type: 'p',
          text: 'A company groups contacts who work at the same organisation. Linking a contact to a company means their calls, deals and notes roll up where a manager can see them together.',
        },
        {
          type: 'figure',
          name: 'company-detail',
          alt: 'A company page listing its contacts and deals',
          caption: 'A company and its people.',
        },
        {
          type: 'p',
          text: 'The list shows how many open deals each company has and what they are worth, so the biggest opportunities are visible without opening anything.',
        },
        { type: 'related', ids: ['contacts', 'deals'] },
      ],
    },
  ],
};

export const leads: Chapter = {
  id: 'leads',
  title: 'Leads',
  icon: Target,
  group: 'Working with records',
  feature: 'leads',
  permission: 'lead:read',
  summary: 'Enquiries that have not yet become customers, and how to convert them.',
  sections: [
    {
      id: 'what-is-a-lead',
      heading: 'What a lead is',
      blocks: [
        {
          type: 'p',
          text: 'A lead is someone who has shown interest but is not yet in your book of business: a form submission, a cold call, a name from an event. Keeping them separate from contacts stops your contact list filling with people you have never spoken to.',
        },
        {
          type: 'figure',
          name: 'leads-list',
          alt: 'The leads list with status and source filters',
          caption: 'Leads, filtered by status.',
        },
      ],
    },
    {
      id: 'qualifying',
      heading: 'Working a lead',
      permission: 'lead:update',
      blocks: [
        {
          type: 'p',
          text: 'Move a lead through its statuses as you learn more: new, contacted, qualified, unqualified. The status strip on the lead’s page changes it in one click.',
        },
      ],
    },
    {
      id: 'converting',
      heading: 'Converting a lead',
      permission: 'lead:convert',
      blocks: [
        {
          type: 'p',
          text: 'When a lead becomes real business, convert it. One step creates the contact, the company and the deal, and links them together.',
        },
        {
          type: 'diagram',
          name: 'LeadConversion',
          caption: 'Converting a lead creates a contact, a company and a deal in one step.',
        },
        {
          type: 'figure',
          name: 'convert-lead',
          alt: 'The convert lead dialog',
          caption: 'Converting a lead.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'The lead itself stays in the list, marked converted, so you keep the record of where the business came from.',
        },
        { type: 'related', ids: ['contacts', 'deals', 'web-forms'] },
      ],
    },
  ],
};

export const deals: Chapter = {
  id: 'deals',
  title: 'Deals and pipelines',
  icon: Kanban,
  group: 'Working with records',
  feature: 'deals',
  permission: 'deal:read',
  summary: 'Opportunities you are working on, the stages they move through, and the forecast.',
  sections: [
    {
      id: 'board',
      heading: 'The board and the list',
      blocks: [
        {
          type: 'p',
          text: 'The board shows deals as cards in columns, one column per stage. Drag a card to move the deal along. The list view shows the same deals as a table when you would rather sort and filter than drag.',
        },
        {
          type: 'figure',
          name: 'deals-board',
          alt: 'The deals board with cards in stage columns',
          caption: 'The deal board.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'If someone else moves the same deal while you are dragging it, the CRM tells you and reloads rather than quietly overwriting their change.',
        },
      ],
    },
    {
      id: 'stages',
      heading: 'Stages and probability',
      blocks: [
        {
          type: 'diagram',
          name: 'DealPipeline',
          caption: 'A pipeline is an ordered set of stages, each with a probability.',
        },
        {
          type: 'p',
          text: 'Each stage carries a probability. A deal worth 100,000 in a stage with a 40 percent probability contributes 40,000 to the forecast. That is the only thing probability does, and it is why keeping stages honest matters.',
        },
      ],
    },
    {
      id: 'won-lost',
      heading: 'Winning and losing',
      permission: 'deal:change_stage',
      blocks: [
        {
          type: 'p',
          text: 'Move a deal to Won or Lost to close it. Losing one asks why, and the reason is worth giving: the conversion report is built from these answers.',
        },
        {
          type: 'figure',
          name: 'lost-reason',
          alt: 'The lost reason dialog',
          caption: 'Recording why a deal was lost.',
        },
      ],
    },
    {
      id: 'pipelines-admin',
      heading: 'Setting up pipelines',
      permission: 'pipeline:manage',
      blocks: [
        {
          type: 'p',
          text: 'Settings, Pipelines is where stages are created, reordered and given their probabilities. Most businesses need one pipeline; separate pipelines make sense when you sell two things that genuinely move through different steps.',
        },
        { type: 'related', ids: ['reports', 'settings'] },
      ],
    },
  ],
};

export const tasks: Chapter = {
  id: 'tasks',
  title: 'Tasks and reminders',
  icon: SquareCheck,
  group: 'Working with records',
  permission: 'task:read',
  summary: 'Things to do, when they are due, and being reminded before they are.',
  sections: [
    {
      id: 'list-and-calendar',
      heading: 'The list and the calendar',
      blocks: [
        {
          type: 'p',
          text: 'Tasks show as a list or a calendar; the buttons at the top right switch between them. Quick filters narrow to what is due today or already overdue.',
        },
        {
          type: 'figure',
          name: 'tasks-list',
          alt: 'The task list with quick filters',
          caption: 'Tasks due today.',
        },
        {
          type: 'figure',
          name: 'tasks-calendar',
          alt: 'The task calendar view',
          caption: 'The same tasks on a calendar.',
        },
      ],
    },
    {
      id: 'creating-tasks',
      heading: 'Creating a task',
      permission: 'task:create',
      blocks: [
        {
          type: 'p',
          text: 'Press <kbd>T</kbd> or use New task. Attach it to a contact, company or deal and it appears on that record’s page too, which is how a follow-up stops being forgotten.',
        },
        {
          type: 'p',
          text: 'Set a reminder and the CRM notifies you at that moment, by notification and by email if you have that switched on.',
        },
      ],
    },
    {
      id: 'completing',
      heading: 'Completing and reassigning',
      permission: 'task:update',
      blocks: [
        {
          type: 'p',
          text: 'Tick a task to complete it. Select several and the bar at the top lets you complete or reassign all of them at once.',
        },
        { type: 'related', ids: ['notifications', 'contacts'] },
      ],
    },
  ],
};

export const notesFiles: Chapter = {
  id: 'notes-files',
  title: 'Notes and files',
  icon: StickyNote,
  group: 'Working with records',
  permission: 'note:read',
  summary: 'Writing things down and attaching documents, images, audio or video.',
  sections: [
    {
      id: 'notes',
      heading: 'Notes',
      blocks: [
        {
          type: 'p',
          text: 'Notes live on contacts, companies, deals, leads and individual calls. Press <kbd>N</kbd> on a record to add one. They appear in the timeline in order, so the next person to pick up the account can read what happened.',
        },
        {
          type: 'figure',
          name: 'notes-panel',
          alt: 'The notes panel on a record with an attachment',
          caption: 'A note with a file attached.',
        },
      ],
    },
    {
      id: 'attachments',
      heading: 'Attaching files',
      permission: 'note:create',
      blocks: [
        {
          type: 'p',
          text: 'Any note can carry files: photographs, scanned documents, PDFs, spreadsheets, audio and video. Use the paperclip when writing the note.',
        },
        {
          type: 'table',
          headers: ['What', 'Formats'],
          rows: [
            ['Images', 'JPEG, PNG, GIF, WebP, HEIC, AVIF'],
            ['Documents', 'PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV, plain text'],
            ['Audio', 'MP3, WAV, AAC, M4A, WebM, FLAC, AMR'],
            ['Video', 'MP4, WebM, QuickTime, MKV, 3GP'],
            ['Other', 'ZIP archives'],
          ],
        },
        {
          type: 'p',
          text: 'A single file may be up to 32 MB. Images show inline in the note; everything else appears as a link.',
        },
        {
          type: 'p',
          text: 'A contact’s Files tab gathers everything attached to them, whether it arrived on a note or in a WhatsApp conversation.',
        },
        { type: 'related', ids: ['contacts', 'inbox', 'backups-retention'] },
      ],
    },
  ],
};
