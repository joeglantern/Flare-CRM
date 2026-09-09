import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { featureKeys, statement, type Permission } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { CHAPTERS, chapterById, groupChapters, visibleChapters, type Access } from './content';
import { blockText } from './content/blocks';
import { parseInline, stripInline } from './content/inline';
import { chapterForPath } from './context';
import { DIAGRAMS } from './diagrams';
import { buildIndex, search } from './search';
import figuresManifest from './content/figures.json';

const PUBLIC = join(process.cwd(), 'public', 'help');
const ROUTES = join(process.cwd(), 'src', 'routes', '_app');
const ALL: Access = { has: () => true, feature: () => true };
const allPermissions = new Set(
  Object.entries(statement).flatMap(([r, actions]) =>
    (actions as readonly string[]).map((a) => `${r}:${a}`),
  ),
);

describe('manual content', () => {
  it('has unique chapter and section ids', () => {
    const ids = CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHAPTERS) {
      const sectionIds = c.sections.map((s) => s.id);
      expect(new Set(sectionIds).size, `${c.id} has duplicate section ids`).toBe(sectionIds.length);
      expect(c.sections.length, `${c.id} has no sections`).toBeGreaterThan(0);
    }
  });

  it('only names features and permissions that exist', () => {
    for (const c of CHAPTERS) {
      for (const gate of [c, ...c.sections]) {
        if (gate.feature !== undefined) expect(featureKeys).toContain(gate.feature);
        if (gate.permission !== undefined)
          expect(allPermissions, `${c.id}: ${gate.permission}`).toContain(gate.permission);
      }
    }
  });

  it('only links to chapters that exist', () => {
    for (const c of CHAPTERS)
      for (const s of c.sections)
        for (const b of s.blocks)
          if (b.type === 'related')
            for (const id of b.ids) expect(chapterById.has(id), `${c.id} -> ${id}`).toBe(true);
  });

  it('only draws diagrams that exist', () => {
    for (const c of CHAPTERS)
      for (const s of c.sections)
        for (const b of s.blocks)
          if (b.type === 'diagram') expect(Object.keys(DIAGRAMS)).toContain(b.name);
  });

  it('reduces every block to something searchable', () => {
    for (const c of CHAPTERS)
      for (const s of c.sections)
        for (const b of s.blocks) {
          const text = blockText(b);
          // 'related' is navigation, not content, so it is the one block with nothing to index
          if (b.type !== 'related')
            expect(text.length, `${c.id}/${s.id}/${b.type}`).toBeGreaterThan(0);
        }
  });

  it('gives every figure a description for a reader who cannot see it', () => {
    for (const c of CHAPTERS)
      for (const s of c.sections)
        for (const b of s.blocks)
          if (b.type === 'figure') expect(b.alt.length, `${c.id}/${b.name}`).toBeGreaterThan(8);
  });
});

/**
 * Figures are captured from the running app by scripts/capture-help-figures.mjs. Some states
 * cannot be reached on a dev machine at all: a call popup needs a live PBX, a template picker
 * needs an expired WhatsApp window. Those figures are simply not captured, and the manual leaves
 * them out rather than rendering a broken image, so the invariant that matters is not "everything
 * has been photographed" but "nothing the manual will try to render is missing".
 */
describe('manual figures on disk', () => {
  const manifest = figuresManifest as Record<string, { width: number; height: number }>;
  const referenced = new Set(
    CHAPTERS.flatMap((c) =>
      c.sections.flatMap((s) =>
        s.blocks.filter((b) => b.type === 'figure').map((b) => `${c.id}/${b.name}`),
      ),
    ),
  );

  it('has every file a browser could ask for, for each figure it will render', () => {
    const missing = Object.keys(manifest).filter((key) => {
      const [chapter, name] = key.split('/');
      return [
        `${name}-light.png`,
        `${name}-light.avif`,
        `${name}-light.webp`,
        `${name}-dark.avif`,
        `${name}-dark.webp`,
      ].some((file) => !existsSync(join(PUBLIC, chapter ?? '', file)));
    });
    expect(missing).toEqual([]);
  });

  it('ships no dark PNG, which nothing would ever load', () => {
    const stray = Object.keys(manifest).filter((key) => {
      const [chapter, name] = key.split('/');
      return existsSync(join(PUBLIC, chapter ?? '', `${name}-dark.png`));
    });
    expect(stray).toEqual([]);
  });

  it('has no figure on disk that no chapter asks for', () => {
    expect(Object.keys(manifest).filter((key) => !referenced.has(key))).toEqual([]);
  });

  it('asks for figures under a chapter id that exists', () => {
    for (const key of referenced) expect(chapterById.has(key.split('/')[0] ?? '')).toBe(true);
  });
});

describe('inline markup', () => {
  it('reads kbd and em, and leaves everything else as text', () => {
    expect(parseInline('Press <kbd>Ctrl K</kbd> to search')).toEqual([
      { kind: 'text', value: 'Press ' },
      { kind: 'kbd', value: 'Ctrl K' },
      { kind: 'text', value: ' to search' },
    ]);
    expect(stripInline('Use <em>Columns</em> to choose')).toBe('Use Columns to choose');
  });
  it('treats anything else as literal text rather than markup', () => {
    expect(parseInline('a < b and <script>x</script>')).toEqual([
      { kind: 'text', value: 'a < b and <script>x</script>' },
    ]);
  });
});

describe('manual search', () => {
  const index = buildIndex(visibleChapters(ALL));

  it('puts the section that is actually about the word first', () => {
    expect(search(index, 'transfer')[0]).toMatchObject({
      chapterId: 'calls',
      sectionId: 'transfer',
    });
    expect(search(index, 'duplicates')[0]).toMatchObject({ chapterId: 'contacts' });
    expect(search(index, 'glossary')[0]?.chapterId).toBe('glossary');
  });

  it('requires every word to appear somewhere', () => {
    expect(search(index, 'transfer zzzzz')).toEqual([]);
  });

  it('ignores a query too short to mean anything', () => {
    expect(search(index, 'a')).toEqual([]);
  });

  it('returns a snippet showing why it matched', () => {
    const hit = search(index, 'retention')[0];
    expect(hit?.snippet.toLowerCase()).toContain('retention');
  });
});

describe('manual gating', () => {
  it('leaves out chapters for features the plan does not include', () => {
    const noTelephony = visibleChapters({
      has: () => true,
      feature: (f) => f !== 'telephony' && f !== 'recordings',
    });
    const ids = noTelephony.map((c) => c.id);
    expect(ids).not.toContain('calls');
    expect(ids).not.toContain('recordings');
    expect(ids).not.toContain('live-calls');
    expect(ids).toContain('contacts');
    // the settings chapter survives, minus its telephony sections
    const settings = noTelephony.find((c) => c.id === 'settings');
    expect(settings?.sections.map((s) => s.id)).not.toContain('telephony');
    expect(settings?.sections.map((s) => s.id)).toContain('general');
  });

  it('leaves out chapters the role cannot use', () => {
    const agent: Access = {
      has: (p: Permission) => p !== 'audit:read' && p !== 'team:read',
      feature: () => true,
    };
    const ids = visibleChapters(agent).map((c) => c.id);
    expect(ids).not.toContain('audit-log');
    expect(ids).not.toContain('users-roles');
    expect(ids).toContain('getting-started');
  });

  it('never produces an empty group', () => {
    for (const g of groupChapters(visibleChapters(ALL))) {
      expect(g.chapters.length).toBeGreaterThan(0);
    }
  });
});

describe('contextual help', () => {
  it('maps every app route to a chapter that exists', () => {
    const routes = readdirSync(ROUTES, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
      .map((e) => {
        const dir = e.parentPath.replace(ROUTES, '').replace(/\\/g, '/');
        const base = e.name.replace(/\.tsx$/, '').replace(/^index$/, '');
        return `${dir}/${base}`.replace(/\/+$/, '').replace(/\/\//g, '/') || '/home';
      })
      .map((p) => p.replace(/\$\w+/, 'x'));
    for (const route of routes) {
      const target = chapterForPath(route);
      expect(chapterById.has(target.chapter), `${route} -> ${target.chapter}`).toBe(true);
    }
  });

  it('picks the most specific match', () => {
    expect(chapterForPath('/calls/missed')).toEqual({ chapter: 'calls', section: 'missed' });
    expect(chapterForPath('/calls')).toEqual({ chapter: 'calls', section: 'history' });
    expect(chapterForPath('/settings', 'section=plan')).toEqual({ chapter: 'your-plan' });
    expect(chapterForPath('/settings', 'section=users')).toEqual({ chapter: 'users-roles' });
    expect(chapterForPath('/settings')).toEqual({ chapter: 'settings' });
  });

  it('falls back to the start of the manual for anything unknown', () => {
    expect(chapterForPath('/nowhere')).toEqual({ chapter: 'getting-started' });
  });
});
