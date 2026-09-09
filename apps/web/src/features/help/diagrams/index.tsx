/**
 * Manual diagrams: inline SVG drawn on the theme's own CSS variables, so they follow light and
 * dark without a second copy and stay sharp at any zoom or in print. Screenshots show what a
 * screen looks like; these show how something works, which no screenshot can.
 */
import type { ReactNode } from 'react';

const stroke = 'var(--border-strong)';
const accent = 'var(--flare)';
const text = 'var(--text)';
const muted = 'var(--text-muted)';
const surface = 'var(--surface)';

function Frame({ children, viewBox }: { children: ReactNode; viewBox: string }) {
  return (
    <svg
      viewBox={viewBox}
      role="presentation"
      className="h-auto w-full"
      style={{ maxHeight: 320 }}
      fontFamily="var(--font-sans)"
    >
      {children}
    </svg>
  );
}

function Box({
  x,
  y,
  w = 150,
  h = 54,
  title,
  sub,
  highlight = false,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={surface}
        stroke={highlight ? accent : stroke}
        strokeWidth={highlight ? 2 : 1}
      />
      <text
        x={x + w / 2}
        y={y + (sub ? 23 : h / 2 + 4)}
        textAnchor="middle"
        fontSize="13"
        fill={text}
      >
        {title}
      </text>
      {sub !== undefined && (
        <text x={x + w / 2} y={y + 40} textAnchor="middle" fontSize="11" fill={muted}>
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({
  from,
  to,
  label,
  dashed = false,
}: {
  from: [number, number];
  to: [number, number];
  label?: string;
  dashed?: boolean;
}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke}
        strokeWidth={1.5}
        markerEnd="url(#help-arrow)"
        {...(dashed ? { strokeDasharray: '4 4' } : {})}
      />
      {label !== undefined && (
        <text
          x={(x1 + x2) / 2}
          y={y1 === y2 ? y1 - 8 : (y1 + y2) / 2 - 6}
          textAnchor="middle"
          fontSize="11"
          fill={muted}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <marker
        id="help-arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
      </marker>
    </defs>
  );
}

export function CallFlow() {
  return (
    <Frame viewBox="0 0 720 200">
      <Defs />
      <Box x={10} y={70} title="Caller" sub="dials your number" />
      <Arrow from={[165, 97]} to={[220, 97]} />
      <Box x={225} y={70} title="Your PBX" sub="rings the extension" />
      <Arrow from={[380, 97]} to={[435, 97]} label="event" />
      <Box x={440} y={70} title="Flare CRM" sub="matches the number" highlight />
      <Arrow from={[595, 97]} to={[650, 97]} />
      <Box x={655} y={70} w={55} title="You" />
      <text x={365} y={175} textAnchor="middle" fontSize="11" fill={muted}>
        The popup appears while the phone is still ringing, so the caller is known before you
        answer.
      </text>
    </Frame>
  );
}

export function LeadConversion() {
  return (
    <Frame viewBox="0 0 620 230">
      <Defs />
      <Box x={20} y={90} title="Lead" sub="someone who enquired" highlight />
      <Arrow from={[175, 117]} to={[240, 117]} label="convert" />
      <Box x={250} y={20} title="Contact" sub="the person" />
      <Box x={250} y={90} title="Company" sub="where they work" />
      <Box x={250} y={160} title="Deal" sub="the opportunity" />
      <text x={310} y={222} textAnchor="middle" fontSize="11" fill={muted}>
        One step creates all three and links them together. The lead stays, marked converted.
      </text>
    </Frame>
  );
}

export function DealPipeline() {
  const stages = ['New', 'Contacted', 'Qualified', 'Proposal', 'Won'];
  return (
    <Frame viewBox="0 0 720 150">
      <Defs />
      {stages.map((s, i) => (
        <g key={s}>
          <Box x={10 + i * 142} y={40} w={122} h={46} title={s} highlight={s === 'Won'} />
          {i < stages.length - 1 && <Arrow from={[134 + i * 142, 63]} to={[148 + i * 142, 63]} />}
        </g>
      ))}
      <text x={360} y={120} textAnchor="middle" fontSize="11" fill={muted}>
        Each stage carries a probability, which is what the forecast multiplies the deal value by.
      </text>
    </Frame>
  );
}

export function WhatsAppWindow() {
  return (
    <Frame viewBox="0 0 720 180">
      <Defs />
      <line x1={40} y1={70} x2={680} y2={70} stroke={stroke} strokeWidth={1.5} />
      <circle cx={60} cy={70} r={6} fill={accent} />
      <text x={60} y={50} textAnchor="middle" fontSize="11" fill={text}>
        They message you
      </text>
      <rect x={60} y={62} width={430} height={16} rx={8} fill="var(--flare-subtle)" />
      <text x={275} y={98} textAnchor="middle" fontSize="12" fill={text}>
        24 hours: reply with anything
      </text>
      <circle cx={490} cy={70} r={6} fill={stroke} />
      <text x={600} y={98} textAnchor="middle" fontSize="12" fill={muted}>
        After that: approved templates only
      </text>
      <text x={360} y={150} textAnchor="middle" fontSize="11" fill={muted}>
        Every reply from them opens a fresh 24 hours. This is a WhatsApp rule, not a CRM one.
      </text>
    </Frame>
  );
}

export function RolesVisibility() {
  return (
    <Frame viewBox="0 0 620 230">
      <Defs />
      <Box x={20} y={20} w={180} title="Agent" sub="their own records" />
      <Box x={220} y={20} w={180} title="Manager" sub="their team's records" />
      <Box x={420} y={20} w={180} title="Admin" sub="everything" highlight />
      <rect x={20} y={100} width={180} height={40} rx={6} fill="var(--flare-subtle)" />
      <rect
        x={20}
        y={100}
        width={380}
        height={40}
        rx={6}
        fill="none"
        stroke={stroke}
        strokeDasharray="4 4"
      />
      <rect x={20} y={100} width={580} height={40} rx={6} fill="none" stroke={accent} />
      <text x={110} y={125} textAnchor="middle" fontSize="11" fill={text}>
        own
      </text>
      <text x={300} y={125} textAnchor="middle" fontSize="11" fill={muted}>
        team
      </text>
      <text x={500} y={125} textAnchor="middle" fontSize="11" fill={muted}>
        all
      </text>
      <text x={310} y={190} textAnchor="middle" fontSize="11" fill={muted}>
        What an agent sees is set once in Settings, General, and applies everywhere at once.
      </text>
    </Frame>
  );
}

export function BackupRetentionTimeline() {
  return (
    <Frame viewBox="0 0 720 200">
      <Defs />
      <line x1={40} y1={90} x2={680} y2={90} stroke={stroke} strokeWidth={1.5} />
      {[
        { x: 90, label: '02:30 daily', sub: 'snapshot taken' },
        { x: 300, label: 'Nightly', sub: 'expired data removed' },
        { x: 510, label: 'Kept', sub: 'the last 14 snapshots' },
      ].map((m) => (
        <g key={m.label}>
          <circle cx={m.x} cy={90} r={6} fill={accent} />
          <text x={m.x} y={70} textAnchor="middle" fontSize="12" fill={text}>
            {m.label}
          </text>
          <text x={m.x} y={115} textAnchor="middle" fontSize="11" fill={muted}>
            {m.sub}
          </text>
        </g>
      ))}
      <text x={360} y={170} textAnchor="middle" fontSize="11" fill={muted}>
        Deleted records are recoverable from a snapshot until the retention period passes.
      </text>
    </Frame>
  );
}

export function EntitlementsFlow() {
  return (
    <Frame viewBox="0 0 720 190">
      <Defs />
      <Box x={20} y={60} w={170} title="Your provider" sub="changes your plan" />
      <Arrow from={[195, 87]} to={[265, 87]} label="signed" />
      <Box x={270} y={60} w={170} title="Your CRM" sub="checks the signature" highlight />
      <Arrow from={[445, 87]} to={[515, 87]} label="at once" />
      <Box x={520} y={60} w={180} title="Your screen" sub="updates without a reload" />
      <text x={360} y={165} textAnchor="middle" fontSize="11" fill={muted}>
        Nothing is deleted when a feature is switched off; it reappears with everything intact.
      </text>
    </Frame>
  );
}

export const DIAGRAMS = {
  CallFlow,
  LeadConversion,
  DealPipeline,
  WhatsAppWindow,
  RolesVisibility,
  BackupRetentionTimeline,
  EntitlementsFlow,
} as const;

export type DiagramName = keyof typeof DIAGRAMS;
