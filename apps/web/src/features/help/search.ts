/**
 * Manual search: a small index built once from the visible chapters, matched in the browser.
 *
 * There is no search endpoint for help and there should not be: the whole manual is a few tens of
 * kilobytes of text that is already in the bundle, and a reader looking for "transfer" wants an
 * answer before a round trip completes.
 */
import type { Chapter } from './content/types';
import { blockText } from './content/blocks';

export interface IndexEntry {
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  heading: string;
  /** Lowercased for matching. */
  title: string;
  body: string;
  /** Original-case body, for building the snippet. */
  raw: string;
}

export interface SearchHit {
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  heading: string;
  snippet: string;
  score: number;
}

export function buildIndex(chapters: Chapter[]): IndexEntry[] {
  return chapters.flatMap((c) =>
    c.sections.map((s) => {
      const raw = [s.heading, ...s.blocks.map(blockText)].filter(Boolean).join(' ');
      return {
        chapterId: c.id,
        chapterTitle: c.title,
        sectionId: s.id,
        title: `${c.title} ${c.summary}`.toLowerCase(),
        heading: s.heading,
        body: raw.toLowerCase(),
        raw,
      };
    }),
  );
}

/**
 * Every term must appear somewhere in the section, then the score says where: a chapter title
 * beats a section heading, which beats body text, and the exact phrase beats scattered words.
 */
export function search(index: IndexEntry[], query: string, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const hits: SearchHit[] = [];
  for (const entry of index) {
    const headingLower = entry.heading.toLowerCase();
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      const inTitle = entry.title.includes(term);
      const inHeading = headingLower.includes(term);
      const inBody = entry.body.includes(term);
      if (!inTitle && !inHeading && !inBody) {
        matchedAll = false;
        break;
      }
      if (inTitle) score += 10;
      if (inHeading) score += 5;
      if (inBody) score += 1;
    }
    if (!matchedAll) continue;
    if (terms.length > 1 && entry.body.includes(q)) score += 8;
    if (headingLower === q) score += 20;
    hits.push({
      chapterId: entry.chapterId,
      chapterTitle: entry.chapterTitle,
      sectionId: entry.sectionId,
      heading: entry.heading,
      snippet: snippet(entry.raw, terms[0] ?? ''),
      score,
    });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.heading.localeCompare(b.heading))
    .slice(0, limit);
}

/** A window of the body around the first hit, so the reader can see why it matched. */
function snippet(raw: string, term: string): string {
  const at = term === '' ? -1 : raw.toLowerCase().indexOf(term);
  if (at === -1) return raw.slice(0, 140) + (raw.length > 140 ? '…' : '');
  const start = Math.max(0, at - 60);
  const end = Math.min(raw.length, at + 100);
  return `${start > 0 ? '…' : ''}${raw.slice(start, end).trim()}${end < raw.length ? '…' : ''}`;
}
