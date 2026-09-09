import { BookOpen, LifeBuoy, Search } from 'lucide-react';
import { SHORTCUT_GROUPS } from '@/app/shell/shortcuts';
import type { Chapter } from '../types';

export const searchShortcuts: Chapter = {
  id: 'search-shortcuts',
  title: 'Search and shortcuts',
  icon: Search,
  group: 'Reference',
  summary: 'Finding anything quickly, and working without the mouse.',
  sections: [
    {
      id: 'palette',
      heading: 'The command palette',
      blocks: [
        {
          type: 'p',
          text: 'Press <kbd>Ctrl</kbd> <kbd>K</kbd> anywhere, or just <kbd>/</kbd>. Type a name, a company, a deal or a phone number and it searches all of them at once; type what you want to do and it offers that instead.',
        },
        {
          type: 'figure',
          name: 'command-palette',
          alt: 'The command palette with grouped search results',
          caption: 'One box for finding and doing.',
        },
        {
          type: 'p',
          text: 'Type a phone number and calling it is offered first, which is the fastest way to ring someone who is not in the CRM yet.',
        },
      ],
    },
    {
      id: 'shortcuts',
      heading: 'Keyboard shortcuts',
      blocks: [
        {
          type: 'p',
          text: 'Press <kbd>?</kbd> at any time to see this list in the app. Shortcuts are ignored while you are typing in a box, so they never interrupt writing a note.',
        },
        ...SHORTCUT_GROUPS.map((group) => ({
          type: 'shortcuts' as const,
          items: group.items.map((i) => ({ keys: i.keys, label: `${group.title}: ${i.label}` })),
        })),
        { type: 'related', ids: ['getting-started', 'contacts'] },
      ],
    },
  ],
};

export const troubleshooting: Chapter = {
  id: 'troubleshooting',
  title: 'When something looks wrong',
  icon: LifeBuoy,
  group: 'Reference',
  summary: 'Every banner and message the CRM can show you, and what to do about it.',
  sections: [
    {
      id: 'banners',
      heading: 'Banners across the top',
      blocks: [
        {
          type: 'table',
          headers: ['What it says', 'What it means', 'What to do'],
          rows: [
            [
              'You are offline',
              'Your browser has lost its connection to the CRM.',
              'Check your internet. Nothing you type will be saved until it returns, so finish the sentence but do not rely on it.',
            ],
            [
              'PBX disconnected',
              'The CRM cannot reach your phone system. Calls still happen on your handset but no popups appear and click to dial is off.',
              'Tell whoever looks after your phone system. Calls that happen while it is down are collected once it returns.',
            ],
            [
              'WhatsApp channel unavailable',
              'Messages cannot be sent right now.',
              'Incoming messages still arrive and will appear once the connection returns.',
            ],
            [
              'Your plan ends in N days',
              'The subscription is close to its end date.',
              'Contact whoever provides your CRM. Nothing changes until the date passes.',
            ],
            [
              'Your plan ended',
              'The CRM is read only. Nothing has been deleted.',
              'Contact your provider to renew. Calls and messages are still being captured meanwhile.',
            ],
            [
              'A message from your provider',
              'A maintenance notice or similar.',
              'Read it and dismiss it.',
            ],
          ],
        },
        { type: 'figure', name: 'state-banners', alt: 'Examples of the banners' },
      ],
    },
    {
      id: 'messages',
      heading: 'Messages in place of content',
      blocks: [
        {
          type: 'table',
          headers: ['What you see', 'What it means'],
          rows: [
            [
              'You do not have access to this',
              'Your role does not include it. The message names the permission, so an administrator knows exactly what to grant.',
            ],
            [
              'Something is not part of your plan',
              'The feature exists but your subscription does not include it. The message names who to contact.',
            ],
            [
              'Could not load this',
              'Something failed. The message includes a request reference; quoting it lets whoever supports you find exactly that failure in the logs.',
            ],
            ['Nothing here yet', 'The list really is empty, rather than broken.'],
            [
              'Your session has expired',
              'You were signed out for being idle. Sign in again; nothing was lost except anything unsaved.',
            ],
          ],
        },
        { type: 'figure', name: 'state-forbidden', alt: 'The no access message' },
        { type: 'figure', name: 'state-error', alt: 'The error message with a request reference' },
      ],
    },
    {
      id: 'refusals',
      heading: 'When an action is refused',
      blocks: [
        {
          type: 'table',
          headers: ['Refusal', 'Why', 'What to do'],
          rows: [
            [
              'Do not call',
              'The contact is marked do not call.',
              'Respect it. A manager can remove the flag if it was set in error.',
            ],
            [
              'The record was modified by someone else',
              'A colleague changed it while you had it open.',
              'Reload and make your change again, so you do not overwrite theirs.',
            ],
            [
              'A contact with this number already exists',
              'The number is on another record.',
              'Open that record instead, or merge the two if both are real.',
            ],
            [
              'A limit was reached',
              'Your plan caps this, and the message says which cap and where you are against it.',
              'Free something up, such as deactivating an unused account, or ask your provider for more.',
            ],
            [
              'Too many requests',
              'The same action was repeated very quickly, which the CRM slows down deliberately.',
              'Wait a moment and try again.',
            ],
            [
              'The phone system is not reachable',
              'Dialling needs the phone system, which is down.',
              'Use your handset directly until the banner clears.',
            ],
          ],
        },
        { type: 'related', ids: ['your-plan', 'getting-started', 'calls'] },
      ],
    },
  ],
};

export const glossary: Chapter = {
  id: 'glossary',
  title: 'Glossary',
  icon: BookOpen,
  group: 'Reference',
  summary: 'The words this CRM uses and exactly what each one means here.',
  sections: [
    {
      id: 'terms',
      heading: 'Terms',
      blocks: [
        {
          type: 'table',
          headers: ['Term', 'What it means here'],
          rows: [
            [
              'Contact',
              'A person. Has phone numbers and email addresses, and belongs to at most one company.',
            ],
            ['Company', 'An organisation. Groups the contacts who work there.'],
            [
              'Lead',
              'An enquiry that has not become a customer yet. Converting one creates a contact, a company and a deal.',
            ],
            [
              'Deal',
              'An opportunity worth an amount of money, sitting in one stage of a pipeline.',
            ],
            ['Pipeline', 'An ordered set of stages a deal moves through.'],
            ['Stage', 'One step in a pipeline, carrying a probability used by the forecast.'],
            [
              'Task',
              'Something to do, optionally with a due date, a reminder, and a record it belongs to.',
            ],
            [
              'Note',
              'Written text on a record or on one specific call, optionally with files attached.',
            ],
            [
              'Disposition',
              'The outcome of a call, chosen from a list your administrator sets up.',
            ],
            ['Extension', 'The short number that identifies your handset on the phone system.'],
            ['PBX', 'Your phone system. The CRM talks to it to show calls and to dial.'],
            ['Timeline', 'Everything that has happened with a record, in order.'],
            ['Team', 'A group of users. Managers see the work of their team.'],
            ['Audit log', 'The permanent, unchangeable record of who did what.'],
            ['Plan', 'What your subscription includes and caps.'],
            ['Retention', 'How long the CRM keeps something before deleting it automatically.'],
          ],
        },
      ],
    },
  ],
};
