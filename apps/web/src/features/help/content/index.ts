/**
 * The manual, in reading order (docs/22).
 *
 * Chapters and sections are filtered by the reader's plan and role, so nobody is given
 * instructions for a screen they cannot open.
 */
import type { FeatureKey, Permission } from '@crm/shared';
import { CHAPTER_GROUPS, type Chapter, type ChapterGroup, type Section } from './types';
import { gettingStarted, home } from './chapters/getting-started';
import { companies, contacts, deals, leads, notesFiles, tasks } from './chapters/records';
import { calls, liveCalls, recordings } from './chapters/calls';
import {
  importExport,
  inbox,
  notifications,
  reports,
  webForms,
} from './chapters/messaging-reports';
import {
  auditLog,
  backupsRetention,
  security,
  settings,
  usersRoles,
  yourPlan,
} from './chapters/administration';
import { glossary, searchShortcuts, troubleshooting } from './chapters/reference';

export const CHAPTERS: Chapter[] = [
  gettingStarted,
  home,
  contacts,
  companies,
  leads,
  deals,
  tasks,
  notesFiles,
  calls,
  recordings,
  liveCalls,
  inbox,
  reports,
  importExport,
  notifications,
  webForms,
  settings,
  usersRoles,
  security,
  backupsRetention,
  auditLog,
  yourPlan,
  searchShortcuts,
  troubleshooting,
  glossary,
];

export { CHAPTER_GROUPS };
export type { Chapter, ChapterGroup, Section };

export const chapterById = new Map(CHAPTERS.map((c) => [c.id, c]));

export interface Access {
  has: (permission: Permission) => boolean;
  feature: (key: FeatureKey) => boolean;
}

function visible(access: Access, gate: { feature?: FeatureKey; permission?: Permission }): boolean {
  if (gate.feature !== undefined && !access.feature(gate.feature)) return false;
  if (gate.permission !== undefined && !access.has(gate.permission)) return false;
  return true;
}

/** Chapters the reader can actually use, with any sections they cannot removed. */
export function visibleChapters(access: Access): Chapter[] {
  return CHAPTERS.filter((c) => visible(access, c))
    .map((c) => ({ ...c, sections: c.sections.filter((s) => visible(access, s)) }))
    .filter((c) => c.sections.length > 0);
}

export function groupChapters(chapters: Chapter[]): { group: ChapterGroup; chapters: Chapter[] }[] {
  return CHAPTER_GROUPS.map((group) => ({
    group,
    chapters: chapters.filter((c) => c.group === group),
  })).filter((g) => g.chapters.length > 0);
}
