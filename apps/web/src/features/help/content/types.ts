/**
 * The manual's content model (docs/22).
 *
 * Chapters are typed data, not markdown: the same house pattern as the shortcuts registry and the
 * settings sections. That keeps every block renderable, searchable and printable from one source,
 * and makes a broken reference a type error or a failing test rather than a broken page.
 *
 * A chapter or section may name a feature or a permission. Anything the reader's plan or role
 * does not include is left out of the manual entirely: nobody should read instructions for a
 * screen they cannot open.
 */
import type { FeatureKey, Permission, RoleName } from '@crm/shared';
import type { LucideIcon } from 'lucide-react';
import type { DiagramName } from '../diagrams';

export type ChapterGroup =
  | 'Getting started'
  | 'Working with records'
  | 'Calls'
  | 'Messaging'
  | 'Reports and data'
  | 'Administration'
  | 'Reference';

export const CHAPTER_GROUPS: ChapterGroup[] = [
  'Getting started',
  'Working with records',
  'Calls',
  'Messaging',
  'Reports and data',
  'Administration',
  'Reference',
];

export interface Chapter {
  id: string;
  title: string;
  icon: LucideIcon;
  group: ChapterGroup;
  feature?: FeatureKey;
  permission?: Permission;
  /** One sentence, shown in the chapter list and in search results. */
  summary: string;
  sections: Section[];
}

export interface Section {
  id: string;
  heading: string;
  feature?: FeatureKey;
  permission?: Permission;
  blocks: Block[];
}

/**
 * Paragraph text may contain <kbd>Ctrl K</kbd> and <em>emphasis</em>, parsed by content/inline.ts.
 * Nothing else: the text is authored here, not by a user, but a manual that renders arbitrary
 * markup is one copy-paste away from being a way to inject one.
 */
export type Block =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'callout'; tone: 'info' | 'warning' | 'danger' | 'success'; text: string }
  | { type: 'figure'; name: string; alt: string; caption?: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'diagram'; name: DiagramName; caption: string }
  | { type: 'shortcuts'; items: { keys: string; label: string }[] }
  | { type: 'related'; ids: string[] }
  /** The role and permission matrix, rendered from packages/shared so it cannot drift. */
  | { type: 'permissions'; roles: RoleName[] };

export type BlockType = Block['type'];
