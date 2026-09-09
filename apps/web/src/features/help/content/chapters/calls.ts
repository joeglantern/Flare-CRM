import { AudioLines, Phone, Radio } from 'lucide-react';
import type { Chapter } from '../types';

export const calls: Chapter = {
  id: 'calls',
  title: 'Calls',
  icon: Phone,
  group: 'Calls',
  feature: 'telephony',
  permission: 'call:read',
  summary: 'The popup, dialling, transferring, recording outcomes, and the call history.',
  sections: [
    {
      id: 'how-a-call-arrives',
      heading: 'How a call reaches you',
      blocks: [
        {
          type: 'diagram',
          name: 'CallFlow',
          caption: 'From the caller to the popup on your screen.',
        },
        {
          type: 'p',
          text: 'Your phone system tells the CRM about the call while it is still ringing. The CRM looks up the number and shows you who is calling before you pick up, along with what happened last time you spoke.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'You still answer on your desk phone or headset as usual. The CRM is showing you the call, not carrying the audio, unless your workspace has the softphone.',
        },
      ],
    },
    {
      id: 'the-popup',
      heading: 'The call popup',
      blocks: [
        {
          type: 'figure',
          name: 'call-popup',
          alt: 'The incoming call popup showing the caller and their recent activity',
          caption: 'An incoming call from a known contact.',
        },
        {
          type: 'p',
          text: 'The popup shows the caller’s name, their company, and the last few things that happened with them. An unknown number shows the number itself and offers to link it to a contact.',
        },
        {
          type: 'shortcuts',
          items: [
            { keys: 'Enter', label: 'Answer' },
            { keys: 'Esc', label: 'Decline' },
            { keys: 'H', label: 'Hold or resume' },
            { keys: 'M', label: 'Mute or unmute' },
          ],
        },
        {
          type: 'figure',
          name: 'call-popup-controls',
          alt: 'The popup during a call with hold, mute and transfer controls',
          caption: 'Controls while the call is up.',
        },
      ],
    },
    {
      id: 'calling-out',
      heading: 'Calling someone',
      permission: 'call:dial',
      blocks: [
        {
          type: 'p',
          text: 'Click any phone number in the CRM to dial it. Your desk phone rings first; when you pick up, the CRM connects the call.',
        },
        {
          type: 'p',
          text: 'For a number that is not in the CRM, use the dialpad. It shows the exact digits it will send to the phone system, including any outside line prefix, so a misdial is visible before it happens.',
        },
        {
          type: 'figure',
          name: 'dialpad',
          alt: 'The dialpad with a number entered and recent calls beside it',
          caption: 'The dialpad.',
        },
        {
          type: 'callout',
          tone: 'warning',
          text: 'Dialling is unavailable without an extension on your profile, or when the phone system is disconnected. The button says which of the two it is rather than doing nothing.',
        },
      ],
    },
    {
      id: 'transfer',
      heading: 'Transferring a call',
      permission: 'call:control',
      blocks: [
        {
          type: 'p',
          text: 'Transfer from the popup while the call is up. Pick a colleague by name; the list shows who is free and who is already on a call, so you do not push a caller into another queue.',
        },
        {
          type: 'figure',
          name: 'transfer',
          alt: 'The transfer picker showing colleagues and their status',
          caption: 'Choosing who to transfer to.',
        },
      ],
    },
    {
      id: 'dispositions',
      heading: 'Recording what happened',
      permission: 'call:set_disposition',
      blocks: [
        {
          type: 'p',
          text: 'When a call ends, say how it went. The outcome list is set up by your administrator: interested, not interested, call back, wrong number, and so on.',
        },
        {
          type: 'figure',
          name: 'disposition',
          alt: 'The disposition form after a call',
          caption: 'Recording the outcome.',
        },
        {
          type: 'p',
          text: 'Add a note at the same time and it is attached to that exact call, not just to the contact, so the reason for the call and the outcome stay together. The CRM can also offer to create a follow-up task.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Outcomes are what the call reports count. A call with no outcome is still logged, but it cannot be counted as interested or not.',
        },
      ],
    },
    {
      id: 'history',
      heading: 'Call history',
      blocks: [
        {
          type: 'p',
          text: 'Calls lists everything: who called whom, when, how long it lasted and what the outcome was. Agents see their own calls; managers and administrators can see the team’s.',
        },
        {
          type: 'figure',
          name: 'calls-list',
          alt: 'The call history table',
          caption: 'Call history.',
        },
        {
          type: 'p',
          text: 'Opening a call shows everything about it, including how it was routed through the phone system, which is the first thing to check when a call went somewhere unexpected.',
        },
        {
          type: 'figure',
          name: 'call-detail',
          alt: 'A call detail page with the recording player and routing trail',
          caption: 'One call in full.',
        },
      ],
    },
    {
      id: 'missed',
      heading: 'Missed calls',
      blocks: [
        {
          type: 'p',
          text: 'Missed calls is the same history narrowed to inbound calls nobody answered, with a call back button on each row. It shows how many times that number has tried and whether anyone has since called them back, so the same person is not rung three times or forgotten entirely.',
        },
        {
          type: 'figure',
          name: 'missed-calls',
          alt: 'The missed calls list with attempts and call back buttons',
          caption: 'Missed calls waiting to be returned.',
        },
      ],
    },
    {
      id: 'live',
      heading: 'Live calls',
      permission: 'pbx:view_status',
      blocks: [
        {
          type: 'p',
          text: 'Live calls shows every call happening right now across the team, with a timer. It is a floor view for supervisors; the timers tick locally, so a lost connection shows as disconnected rather than as frozen cards pretending to be live.',
        },
        {
          type: 'figure',
          name: 'live-calls',
          alt: 'The live calls board',
          caption: 'Calls in progress.',
        },
        { type: 'related', ids: ['recordings', 'reports', 'settings'] },
      ],
    },
  ],
};

export const recordings: Chapter = {
  id: 'recordings',
  title: 'Call recordings',
  icon: AudioLines,
  group: 'Calls',
  feature: 'recordings',
  permission: 'call:listen_recording',
  summary: 'Listening back, who may, and how long recordings are kept.',
  sections: [
    {
      id: 'listening',
      heading: 'Listening to a recording',
      blocks: [
        {
          type: 'p',
          text: 'Where a call was recorded, its page has a player. Recordings are fetched from the phone system and stored with the call, so they stay available even if the phone system clears its own copies.',
        },
        {
          type: 'figure',
          name: 'recording-player',
          alt: 'A call page with the recording player and the list of who has listened',
          caption: 'Playing a recording.',
        },
        {
          type: 'callout',
          tone: 'warning',
          text: 'Every play is recorded with your name and the time, and shown on the call page. Recordings are personal data and listening to one is a deliberate act.',
        },
      ],
    },
    {
      id: 'consent',
      heading: 'Telling callers they are recorded',
      blocks: [
        {
          type: 'p',
          text: 'The consent wording your business uses is set in Settings, Recording, and is shown on the popup so agents say the same thing every time. Announcing recording is a legal requirement in most places; the CRM shows the text but cannot say it for you.',
        },
      ],
    },
    {
      id: 'retention',
      heading: 'How long recordings are kept',
      blocks: [
        {
          type: 'p',
          text: 'Recordings are deleted automatically after the period set in Settings, Recording. The default is a year. Deleting is permanent: recordings removed by the retention rule are gone from storage, not hidden.',
        },
        { type: 'related', ids: ['calls', 'backups-retention', 'audit-log'] },
      ],
    },
  ],
};

export const liveCalls: Chapter = {
  id: 'live-calls',
  title: 'Supervising a floor',
  icon: Radio,
  group: 'Calls',
  feature: 'telephony',
  permission: 'pbx:view_status',
  summary: 'Watching calls as they happen and seeing who is available.',
  sections: [
    {
      id: 'board',
      heading: 'The live board',
      blocks: [
        {
          type: 'p',
          text: 'Every call in progress, who is on it, and how long it has been running. Updates arrive as they happen rather than on a refresh.',
        },
        {
          type: 'p',
          text: 'The team panel shows how many people have an extension configured. That is a count of who is set up to take calls, not of who is logged in and ready: the phone system does not report registration to the CRM.',
        },
        { type: 'related', ids: ['calls', 'reports'] },
      ],
    },
  ],
};
