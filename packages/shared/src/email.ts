/**
 * The one layout every email this product sends is built from, for the CRM and the console alike.
 *
 * Email HTML is not web HTML. Outlook renders it with Word and Gmail strips most of a stylesheet,
 * so the layout is tables, every style is inline on its element, there are no web fonts, no SVG
 * and no background images. The block in the head only improves what is already readable: the
 * narrow column and the dark palette. The measurements come from the email design canvas.
 *
 * Every value that reaches the HTML is escaped here, so callers pass plain strings.
 */

export interface EmailSender {
  /**
   * `installation` is a customer's own CRM, `console` is the provider. The footer says which, so a
   * reader can tell a real message from a forgery by the hostname it names.
   */
  kind: 'installation' | 'console';
  /** The customer's name. Null when an installation is not managed and has no name to give. */
  name: string | null;
  /** The hostname every link in a genuine message points to. */
  host: string;
  /** Absolute URL of the mark at twice its display size, or null when no public host serves it. */
  markUrl: string | null;
}

export interface EmailFact {
  label: string;
  value: string;
}

export interface EmailContent {
  to: string;
  subject: string;
  /** The hidden line an inbox shows beside the subject. Never the same words as the subject. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  /** Who, when and why. Rendered as a ruled two column table. */
  facts?: EmailFact[];
  button?: { label: string; url: string };
  /** What to do if this was unexpected, after the button. */
  after?: string[];
  sign: string;
  /** One sentence on why this reader received it. */
  reason: string;
  sender: EmailSender;
}

export interface RenderedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const INK = '#17171A';
const BODY = '#3A3A3D';
const QUIET = '#6B6965';
const RULE = '#E6E4DF';
const PAGE = '#F4F3F0';
const CARD = '#FFFFFF';
const ACCENT = '#FF6A3D';
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = 'ui-monospace,Menlo,Consolas,monospace';
const NEWLINE = String.fromCharCode(10);

export const EMAIL_SIGNATURE_LINE = 'Flare CRM, Nairobi.';

export function escapeEmailHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

const HEAD_STYLE = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
@media (max-width: 620px) {
  .fl-wrap { width: 100% !important; max-width: 100% !important; }
  .fl-pad { padding-left: 24px !important; padding-right: 24px !important; }
  .fl-h1 { font-size: 22px !important; line-height: 30px !important; }
  .fl-btn-table { width: 100% !important; }
  .fl-btn { text-align: center !important; }
  .fl-fact-k { width: 110px !important; }
}
@media (prefers-color-scheme: dark) {
  .fl-page { background: #17171A !important; }
  .fl-card { background: #232326 !important; }
  .fl-ink { color: #F2F1EF !important; }
  .fl-body { color: #D6D4CF !important; }
  .fl-quiet { color: #A3A19C !important; }
  .fl-rule { background: #3A3A3D !important; }
  .fl-fact, .fl-fact td { border-color: #3A3A3D !important; }
}
`;

function footerLines(sender: EmailSender, reason: string): { first: string; html: string } {
  const host = escapeEmailHtml(sender.host);
  const hostSpan = `<span class="fl-body" style="color:${BODY};">${host}</span>`;
  let first: string;
  let firstHtml: string;
  if (sender.kind === 'console') {
    first = `Sent by Flare CRM from the provider console at ${sender.host}. Every link in a real message from the console points to that address.`;
    firstHtml = `Sent by Flare CRM from the provider console at ${hostSpan}. Every link in a real message from the console points to that address.`;
  } else if (sender.name === null) {
    first = `Sent from the Flare installation at ${sender.host}. Every link in a real message from this installation points to that address.`;
    firstHtml = `Sent from the Flare installation at ${hostSpan}. Every link in a real message from this installation points to that address.`;
  } else {
    first = `Sent by ${sender.name} from its own Flare installation at ${sender.host}. Every link in a real message from this installation points to that address.`;
    firstHtml = `Sent by ${escapeEmailHtml(sender.name)} from its own Flare installation at ${hostSpan}. Every link in a real message from this installation points to that address.`;
  }
  const p = (inner: string, last: boolean) =>
    `<p style="margin:0 0 ${last ? '0' : '12px'} 0;">${inner}</p>`;
  return {
    first,
    html: p(firstHtml, false) + p(escapeEmailHtml(reason), false) + p(EMAIL_SIGNATURE_LINE, true),
  };
}

function letterhead(sender: EmailSender): string {
  const mark =
    sender.markUrl === null
      ? ''
      : `<td style="vertical-align:middle;padding-right:12px;"><img src="${escapeEmailHtml(sender.markUrl)}" alt="Flare" width="44" height="44" style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:10px;color:${QUIET};"></td>`;
  return `<tr><td class="fl-pad" style="padding:32px 40px 0 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${mark}<td class="fl-ink" style="vertical-align:middle;font-family:${FONT};font-size:22px;line-height:24px;font-weight:800;letter-spacing:-0.03em;color:${INK};">Flare</td><td class="fl-quiet" style="vertical-align:middle;padding-left:8px;font-family:${FONT};font-size:11px;line-height:24px;font-weight:600;letter-spacing:0.22em;color:${QUIET};">CRM</td></tr></table>
</td></tr>
<tr><td class="fl-pad" style="padding:24px 40px 0 40px;"><div class="fl-rule" style="height:1px;line-height:1px;font-size:0;background:${RULE};">&nbsp;</div></td></tr>`;
}

function paragraphs(items: string[], padding: string): string {
  if (items.length === 0) return '';
  const body = items
    .map((item) => `<p style="margin:0 0 16px 0;">${escapeEmailHtml(item)}</p>`)
    .join('');
  return `<tr><td class="fl-pad fl-body" style="padding:${padding};font-family:${FONT};font-size:16px;line-height:24px;color:${BODY};">${body}</td></tr>`;
}

function factsTable(facts: EmailFact[]): string {
  const rows = facts
    .map(
      (f) =>
        `<tr><td class="fl-quiet fl-fact-k" valign="top" style="padding:10px 16px 10px 0;width:150px;font-family:${FONT};font-size:14px;line-height:22px;color:${QUIET};border-bottom:1px solid ${RULE};">${escapeEmailHtml(f.label)}</td><td class="fl-ink" valign="top" style="padding:10px 0;font-family:${FONT};font-size:14px;line-height:22px;color:${INK};border-bottom:1px solid ${RULE};">${escapeEmailHtml(f.value)}</td></tr>`,
    )
    .join('');
  return `<tr><td class="fl-pad" style="padding:8px 40px 24px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fl-fact" style="width:100%;border-top:1px solid ${RULE};">${rows}</table></td></tr>`;
}

/**
 * A table cell with the colour and padding, never a padded link, which Outlook shows as bare text.
 * Outlook gets a VML rectangle of the same size instead. The address follows as plain text so it can
 * be copied by somebody who does not trust the button.
 */
function button(label: string, url: string): string {
  const href = escapeEmailHtml(url);
  const text = escapeEmailHtml(label);
  const width = Math.max(200, Math.round(label.length * 9.5) + 56);
  return `<tr><td class="fl-pad" style="padding:8px 40px 0 40px;">
<!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${String(width)}px;" stroke="f" fillcolor="${ACCENT}"><w:anchorlock/><center style="color:${INK};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${text}</center></v:rect><![endif]-->
<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0" class="fl-btn-table"><tr><td class="fl-btn" bgcolor="${ACCENT}" style="background:${ACCENT};padding:14px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${INK};"><a href="${href}" style="color:${INK};text-decoration:none;display:inline-block;">${text}</a></td></tr></table><!--<![endif]-->
</td></tr>
<tr><td class="fl-pad fl-quiet" style="padding:16px 40px 0 40px;font-family:${FONT};font-size:13px;line-height:20px;color:${QUIET};">If the button does not work, copy this address into your browser.<br><span class="fl-body" style="font-family:${MONO};word-break:break-all;color:${BODY};">${href}</span></td></tr>`;
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const facts = content.facts ?? [];
  const after = content.after ?? [];
  const footer = footerLines(content.sender, content.reason);

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeEmailHtml(content.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>${HEAD_STYLE}</style>
</head>
<body class="fl-page" style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(content.preheader)}${'&zwnj;&nbsp;'.repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fl-page" style="width:100%;background:${PAGE};">
<tr><td align="center" style="padding:32px 0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="fl-wrap" style="width:600px;max-width:600px;">
<tr><td class="fl-card" bgcolor="${CARD}" style="background:${CARD};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
${letterhead(content.sender)}
<tr><td class="fl-pad fl-ink fl-h1" style="padding:32px 40px 0 40px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.01em;color:${INK};">${escapeEmailHtml(content.heading)}</td></tr>
${paragraphs(content.paragraphs, '16px 40px 0 40px')}
${facts.length > 0 ? factsTable(facts) : ''}
${content.button ? button(content.button.label, content.button.url) : ''}
${paragraphs(after, '24px 40px 0 40px')}
<tr><td class="fl-pad fl-body" style="padding:8px 40px 40px 40px;font-family:${FONT};font-size:16px;line-height:24px;color:${BODY};">${escapeEmailHtml(content.sign)}</td></tr>
</table>
</td></tr>
<tr><td class="fl-pad fl-quiet" style="padding:32px 40px 8px 40px;font-family:${FONT};font-size:13px;line-height:20px;color:${QUIET};">${footer.html}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const blocks: string[] = [content.heading, content.paragraphs.join(NEWLINE + NEWLINE)];
  if (facts.length > 0) blocks.push(facts.map((f) => `${f.label}: ${f.value}`).join(NEWLINE));
  if (content.button) blocks.push(`${content.button.label}:${NEWLINE}${content.button.url}`);
  if (after.length > 0) blocks.push(after.join(NEWLINE + NEWLINE));
  blocks.push(content.sign);
  blocks.push([footer.first, content.reason, EMAIL_SIGNATURE_LINE].join(NEWLINE));

  return {
    to: content.to,
    subject: content.subject,
    text: blocks.filter((b) => b !== '').join(NEWLINE + NEWLINE) + NEWLINE,
    html,
  };
}

/**
 * Zones people here actually use, by the letters they would recognise. Anything else gets whatever
 * the runtime calls it, which is at worst an offset like GMT+1 and never wrong.
 */
const ZONE_LETTERS: Record<string, string> = {
  'Africa/Nairobi': 'EAT',
  'Africa/Kampala': 'EAT',
  'Africa/Dar_es_Salaam': 'EAT',
  'Africa/Addis_Ababa': 'EAT',
  'Africa/Mogadishu': 'EAT',
  'Africa/Kigali': 'CAT',
  'Africa/Lusaka': 'CAT',
  'Africa/Harare': 'CAT',
  'Africa/Johannesburg': 'SAST',
  'Africa/Lagos': 'WAT',
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
};

const DEFAULT_ZONE = 'Africa/Nairobi';

function usableZone(timeZone: string | null | undefined): string {
  if (timeZone === null || timeZone === undefined || timeZone === '') return DEFAULT_ZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_ZONE;
  }
}

function zoneLetters(date: Date, timeZone: string): string {
  const known = ZONE_LETTERS[timeZone];
  if (known !== undefined) return known;
  const part = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

function parts(date: Date, timeZone: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) {
    out[p.type] = p.value;
  }
  return out;
}

/** `Thursday 10 September 2026, 21:14 EAT`, in the reader's zone with the zone named. */
export function emailDateTime(date: Date, timeZone?: string | null): string {
  const zone = usableZone(timeZone);
  const p = parts(date, zone);
  return `${p.weekday ?? ''} ${p.day ?? ''} ${p.month ?? ''} ${p.year ?? ''}, ${p.hour ?? ''}:${p.minute ?? ''} ${zoneLetters(date, zone)}`;
}

/** `14:02 EAT`, for a time the reader will meet today. */
export function emailClock(date: Date, timeZone?: string | null): string {
  const zone = usableZone(timeZone);
  const p = parts(date, zone);
  return `${p.hour ?? ''}:${p.minute ?? ''} ${zoneLetters(date, zone)}`;
}

/** The name somebody would be greeted by: the first word of what they set as their name. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first === undefined || first === '' ? name.trim() : first;
}
