/**
 * The only markup the manual's prose understands: <kbd>Ctrl K</kbd> and <em>emphasis</em>.
 *
 * A tokeniser rather than anything that touches innerHTML. Everything outside these two tags is
 * text, so a stray angle bracket in the copy renders as an angle bracket instead of vanishing.
 */
export type InlineToken =
  { kind: 'text'; value: string } | { kind: 'kbd'; value: string } | { kind: 'em'; value: string };

const TAG = /<(kbd|em)>([\s\S]*?)<\/\1>/g;

export function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(TAG)) {
    const at = match.index;
    if (at > last) out.push({ kind: 'text', value: text.slice(last, at) });
    out.push({ kind: match[1] === 'kbd' ? 'kbd' : 'em', value: match[2] ?? '' });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/** The same text with the tags removed, for search indexing and the plain-text reduction. */
export function stripInline(text: string): string {
  return parseInline(text)
    .map((t) => t.value)
    .join('');
}
