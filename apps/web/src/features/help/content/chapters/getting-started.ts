import { Compass, LayoutDashboard } from 'lucide-react';
import type { Chapter } from '../types';

export const gettingStarted: Chapter = {
  id: 'getting-started',
  title: 'Getting started',
  icon: Compass,
  group: 'Getting started',
  summary: 'Sign in for the first time, set up two-factor, and find your way around.',
  sections: [
    {
      id: 'first-sign-in',
      heading: 'Signing in for the first time',
      blocks: [
        {
          type: 'p',
          text: 'Your administrator creates your account, and the CRM emails you a link to set your password. The link works once and expires, so if it has been sitting in your inbox for a while, ask for a new one rather than guessing.',
        },
        {
          type: 'steps',
          items: [
            'Open the email titled "Welcome to Flare CRM" and click the link.',
            'Choose a password of at least 12 characters. A phrase you can remember beats a short jumble you cannot.',
            'You are taken to the sign-in page. Enter your email and the password you just set.',
          ],
        },
        {
          type: 'figure',
          name: 'sign-in',
          alt: 'The sign-in page with email and password fields',
          caption: 'The sign-in page.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'If sign-in says the details are wrong and you are sure they are not, check whether your account was deactivated. The CRM says so explicitly in that case.',
        },
      ],
    },
    {
      id: 'two-factor',
      heading: 'Setting up two-factor authentication',
      blocks: [
        {
          type: 'p',
          text: 'Administrators and managers must turn on two-factor authentication before they can use the CRM, because those roles can see and change everyone else’s work. Your workspace may require it of everyone.',
        },
        {
          type: 'p',
          text: 'You need an authenticator app on your phone. Google Authenticator, Microsoft Authenticator and 1Password all work; any app that shows six-digit codes will do.',
        },
        {
          type: 'steps',
          items: [
            'When prompted, enter your password again to prove it is you.',
            'Scan the square code with your authenticator app. If you cannot scan it, tap "Can’t scan it?" and type the letters shown into the app by hand.',
            'Your app now shows a six-digit code that changes every thirty seconds. Type the current one into the CRM.',
            'Save the backup codes somewhere safe and away from your phone. Each one works once.',
          ],
        },
        {
          type: 'figure',
          name: 'two-factor-setup',
          alt: 'Two-factor setup showing a QR code and a field for the six digit code',
          caption: 'Scan the code, then type what your app shows.',
        },
        {
          type: 'callout',
          tone: 'warning',
          text: 'If you lose your phone, use one of your backup codes to sign in, then set the authenticator up again. If the backup codes are gone too, an administrator can reset your two-factor from Settings, Users; nobody can recover the old one, which is the point of it.',
        },
      ],
    },
    {
      id: 'your-profile',
      heading: 'Your profile and time zone',
      blocks: [
        {
          type: 'p',
          text: 'Open your name at the bottom of the sidebar to reach your profile. Your name and photo are what colleagues see next to your calls and notes.',
        },
        {
          type: 'p',
          text: 'Every date and time in the CRM is shown in the time zone on your profile, so a call logged at 14:05 in Nairobi reads as 14:05 for you and as the right local time for a colleague elsewhere.',
        },
        {
          type: 'p',
          text: 'Your extension is set by an administrator, not by you. Without one the CRM cannot dial for you or match incoming calls to your phone.',
        },
        { type: 'figure', name: 'profile', alt: 'The profile screen', caption: 'Your account.' },
      ],
    },
    {
      id: 'theme',
      heading: 'Light and dark',
      blocks: [
        {
          type: 'p',
          text: 'The sun and moon button in the top bar switches between light and dark. The choice is remembered in the browser you are using, so it does not follow you to another computer and does not affect anyone else.',
        },
      ],
    },
    {
      id: 'on-a-phone',
      heading: 'On a phone or tablet',
      blocks: [
        {
          type: 'p',
          text: 'The CRM works on a phone. The sidebar becomes a menu behind the button at the top left; everything else is the same product, with wide tables scrolling sideways rather than being cut off.',
        },
        {
          type: 'figure',
          name: 'mobile-nav',
          alt: 'The navigation drawer open on a phone',
          caption: 'The menu on a phone.',
        },
      ],
    },
    {
      id: 'signing-out',
      heading: 'Signing out and being signed out',
      blocks: [
        {
          type: 'p',
          text: 'Sign out from the menu under your avatar in the top bar. The CRM also signs you out on its own after a period of inactivity, set by your administrator, and tells you that is what happened rather than silently failing.',
        },
        { type: 'related', ids: ['home', 'search-shortcuts', 'security'] },
      ],
    },
  ],
};

export const home: Chapter = {
  id: 'home',
  title: 'The home screen',
  icon: LayoutDashboard,
  group: 'Getting started',
  summary: 'What the CRM puts in front of you when you arrive, and why.',
  sections: [
    {
      id: 'your-day',
      heading: 'Your day',
      blocks: [
        {
          type: 'p',
          text: 'Home is a to-do list, not a dashboard of numbers. It shows what is waiting for you: tasks that are overdue, missed calls nobody has returned, unread messages, and the deals you own.',
        },
        {
          type: 'figure',
          name: 'home',
          alt: 'The home screen showing tasks, missed calls and deals',
          caption: 'Home for an agent.',
        },
        {
          type: 'p',
          text: 'Every card is a real, live query. If a card is empty, there genuinely is nothing there, and clicking through takes you to the full list.',
        },
      ],
    },
    {
      id: 'manager-view',
      heading: 'If you manage a team',
      permission: 'report:view_team',
      blocks: [
        {
          type: 'p',
          text: 'Managers and administrators see the team’s numbers instead: calls today, who is on a call right now, the pipeline, and how the work is spread across people.',
        },
        {
          type: 'figure',
          name: 'home-manager',
          alt: 'The manager home board with team numbers and live calls',
          caption: 'Home for a manager.',
        },
      ],
    },
    {
      id: 'banners',
      heading: 'Banners across the top',
      blocks: [
        {
          type: 'p',
          text: 'A coloured strip above the page means something needs your attention: you are offline, the phone system is disconnected, WhatsApp is unavailable, or your provider has posted a notice. Each one says what still works and what does not.',
        },
        { type: 'related', ids: ['troubleshooting'] },
      ],
    },
  ],
};
