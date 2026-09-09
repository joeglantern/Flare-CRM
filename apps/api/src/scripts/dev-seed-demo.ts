/**
 * Local development only: fills the dev database with realistic Kenyan sample data so every
 * screen has something to show (docs/18 sample-data rules — Nairobi companies, Safaricom and
 * Airtel numbers, KES 50k–2M deals, Africa/Nairobi times).
 *
 *   pnpm --filter @crm/api dev:seed-demo
 *
 * Idempotent: rerunning tops the data up rather than duplicating it.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from 'better-auth/crypto';
import { v7 as uuidv7 } from 'uuid';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

const PEOPLE = [
  [
    'Wanjiru',
    'Kamau',
    'Kilimani Auto Parts',
    '0712345678',
    'wanjiru@kilimaniauto.co.ke',
    ['vip', 'wholesale'],
  ],
  [
    'Amina',
    'Hassan',
    'Westlands Dental Centre',
    '0101234567',
    'amina@westlandsdental.co.ke',
    ['dental'],
  ],
  [
    'Kevin',
    'Mwangi',
    'Thika Road Logistics',
    '0722908114',
    'kevin@thikaroad.co.ke',
    ['fleet', 'nairobi'],
  ],
  ['Grace', 'Akinyi', 'Ngong Hills Realty', '0733481902', 'grace@ngonghills.co.ke', ['realty']],
  [
    'Daniel',
    'Njoroge',
    'Mombasa Road Hardware',
    '0110234900',
    'daniel@mombasardhw.co.ke',
    ['wholesale'],
  ],
  ['Samuel', 'Kiptoo', 'Karen Vet Clinic', '0724556010', 'samuel@karenvet.co.ke', []],
  ['Faith', 'Chebet', 'Kilimani Auto Parts', '0798002334', 'faith@kilimaniauto.co.ke', ['vip']],
  ['Brian', 'Otieno', 'Thika Road Logistics', '0700111222', 'brian@thikaroad.co.ke', ['fleet']],
  ['Naomi', 'Chelangat', 'Ngong Hills Realty', '0711900321', 'naomi@ngonghills.co.ke', []],
  ['Peter', 'Wanjala', 'Wanjala Motors', '0110234901', 'peter@wanjalamotors.co.ke', ['webform']],
  ['Mercy', 'Atieno', 'Karen Vet Clinic', '0723445566', 'mercy@karenvet.co.ke', ['vip']],
  ['James', 'Ouma', 'Mombasa Road Hardware', '0102334455', 'james@mombasardhw.co.ke', []],
] as const;

const COMPANIES = [
  [
    'Kilimani Auto Parts',
    'Motor vehicle parts',
    'https://kilimaniauto.co.ke',
    '0202345100',
    'Kilimani, Nairobi',
  ],
  [
    'Westlands Dental Centre',
    'Healthcare',
    'https://westlandsdental.co.ke',
    '0202119900',
    'Westlands, Nairobi',
  ],
  [
    'Thika Road Logistics',
    'Transport and logistics',
    'https://thikaroad.co.ke',
    '0202884411',
    'Ruaraka, Nairobi',
  ],
  ['Ngong Hills Realty', 'Real estate', 'https://ngonghills.co.ke', '0202770011', 'Karen, Nairobi'],
  [
    'Mombasa Road Hardware',
    'Building supplies',
    'https://mombasardhw.co.ke',
    '0202556677',
    'Mombasa Road, Nairobi',
  ],
  ['Karen Vet Clinic', 'Veterinary', 'https://karenvet.co.ke', '0202991122', 'Karen, Nairobi'],
  [
    'Wanjala Motors',
    'Transport and logistics',
    'https://wanjalamotors.co.ke',
    '0110234901',
    'Kitengela, Kajiado',
  ],
] as const;

const AGENTS = [
  ['Brian Otieno', 'brian.otieno@flare.co.ke', 'agent', '1004'],
  ['Faith Chebet', 'faith.chebet@flare.co.ke', 'manager', '1006'],
  ['Samuel Kiptoo', 'samuel.kiptoo@flare.co.ke', 'admin', '1001'],
  ['Daniel Njoroge', 'daniel.njoroge@flare.co.ke', 'agent', '1009'],
  ['Grace Akinyi', 'grace.akinyi@flare.co.ke', 'agent', '1011'],
] as const;

const DEAL_TITLES = [
  ['Brake pads Q3', 480_000],
  ['Fleet servicing contract', 1_250_000],
  ['Clinic refit', 860_000],
  ['Six-truck tyre supply', 640_000],
  ['Site office fit-out', 320_000],
  ['Generator 10 kVA', 210_000],
  ['Annual parts retainer', 1_980_000],
  ['Reception furniture', 95_000],
  ['Workshop tooling', 55_000],
] as const;

const WA_MESSAGES = [
  'Habari, do you deliver to Kilimani? Need 40 brake pads by Friday.',
  'Bei ya generator ya 10 kVA ni ngapi?',
  'Asante, nitakuja kesho asubuhi.',
  'Do you have the 2 pack toothbrush heads in stock? Delivery to Westlands.',
  'Ndio, nitumie invoice kwa email.',
] as const;

const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000);
const daysAgo = (d: number): Date => new Date(Date.now() - d * 86_400_000);
const pick = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;

async function main(): Promise<void> {
  const env = loadEnv({ ...process.env, LOG_LEVEL: 'silent' });
  if (env.NODE_ENV === 'production') throw new Error('dev-seed-demo must not run in production');
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL_MIGRATE ?? env.DATABASE_URL,
    }),
  });

  try {
    const existing = await db.contact.count();
    if (existing > 40) {
      // eslint-disable-next-line no-console
      console.log(`already seeded (${String(existing)} contacts); nothing to do`);
      return;
    }

    // ── teams and users ──────────────────────────────────────────────────────────────────
    const teamId = (await db.team.findFirst({ where: { name: 'Sales' } }))?.id ?? uuidv7();
    await db.team.upsert({
      where: { id: teamId },
      create: { id: teamId, name: 'Sales' },
      update: {},
    });

    const password = await hashPassword('Flare-dev-2026!');
    const takenExtensions = new Set(
      (await db.user.findMany({ where: { extension: { not: null } }, select: { extension: true } }))
        .map((u) => u.extension)
        .filter((e): e is string => e !== null),
    );
    const userIds: string[] = [];
    for (const [name, email, role, extension] of AGENTS) {
      const found = await db.user.findUnique({ where: { email }, select: { id: true } });
      const id = found?.id ?? uuidv7();
      if (!found) {
        // extensions are unique; an already-used one is left unset rather than colliding
        const ext = takenExtensions.has(extension) ? null : extension;
        if (ext !== null) takenExtensions.add(ext);
        await db.user.create({
          data: {
            id,
            name,
            email,
            role,
            extension: ext,
            teamId,
            emailVerified: true,
            isActive: true,
          },
        });
        await db.account.create({
          data: {
            id: uuidv7(),
            userId: id,
            accountId: id,
            providerId: 'credential',
            issuer: 'local:credential',
            password,
          },
        });
      }
      userIds.push(id);
    }
    // put the dev agent on the same team so team-scoped views have content
    await db.user.updateMany({ where: { email: 'agent@flare.local' }, data: { teamId } });
    const devAgent = await db.user.findUnique({
      where: { email: 'agent@flare.local' },
      select: { id: true },
    });
    if (devAgent) userIds.unshift(devAgent.id);

    // ── companies ────────────────────────────────────────────────────────────────────────
    const companyIds = new Map<string, string>();
    for (const [i, [name, industry, website, phone, address]] of COMPANIES.entries()) {
      const found = await db.company.findFirst({ where: { name }, select: { id: true } });
      const id = found?.id ?? uuidv7();
      if (!found) {
        await db.company.create({
          data: {
            id,
            name,
            industry,
            website,
            phoneE164: `+254${phone.slice(1)}`,
            address: { line1: address, city: 'Nairobi', country: 'KE' },
            ownerId: pick(userIds, i),
          },
        });
      }
      companyIds.set(name, id);
    }

    // ── contacts with phones and emails ──────────────────────────────────────────────────
    const contactIds: string[] = [];
    for (const [i, [firstName, lastName, companyName, phone, email, tags]] of PEOPLE.entries()) {
      const displayName = `${firstName} ${lastName}`;
      const found = await db.contact.findFirst({ where: { displayName }, select: { id: true } });
      const id = found?.id ?? uuidv7();
      if (!found) {
        const e164 = `+254${phone.slice(1)}`;
        await db.contact.create({
          data: {
            id,
            firstName,
            lastName,
            displayName,
            companyId: companyIds.get(companyName) ?? null,
            ownerId: i % 5 === 4 ? null : pick(userIds, i),
            source: i % 4 === 0 ? 'call' : i % 4 === 1 ? 'webform' : 'manual',
            tags: [...tags],
            doNotCall: i === 1,
            createdAt: daysAgo(120 - i * 7),
            phones: {
              create: {
                id: uuidv7(),
                e164,
                raw: phone,
                type: 'mobile',
                isPrimary: true,
              },
            },
            emails: { create: { id: uuidv7(), email, isPrimary: true } },
          },
        });
      }
      contactIds.push(id);
    }

    // ── pipeline, deals ──────────────────────────────────────────────────────────────────
    const pipeline = await db.pipeline.findFirst({
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
    if (pipeline !== null && pipeline.stages.length > 0) {
      const open = pipeline.stages.filter((s) => s.type === 'open');
      const won = pipeline.stages.find((s) => s.type === 'won');
      const lost = pipeline.stages.find((s) => s.type === 'lost');
      for (const [i, [title, value]] of DEAL_TITLES.entries()) {
        const found = await db.deal.findFirst({ where: { title }, select: { id: true } });
        if (found) continue;
        const isWon = i === 6;
        const isLost = i === 8;
        const stage = isWon ? (won ?? open[0]) : isLost ? (lost ?? open[0]) : pick(open, i);
        if (!stage) continue;
        await db.deal.create({
          data: {
            id: uuidv7(),
            title,
            contactId: pick(contactIds, i),
            companyId: companyIds.get(pick(COMPANIES, i)[0]) ?? null,
            pipelineId: pipeline.id,
            stageId: stage.id,
            value,
            currency: 'KES',
            probability: stage.probability,
            expectedCloseDate: new Date(Date.now() + (10 + i * 6) * 86_400_000),
            ownerId: pick(userIds, i),
            status: isWon ? 'won' : isLost ? 'lost' : 'open',
            wonAt: isWon ? daysAgo(4) : null,
            lostAt: isLost ? daysAgo(9) : null,
            lostReason: isLost ? 'Went with a cheaper supplier' : null,
            createdAt: daysAgo(60 - i * 5),
          },
        });
      }
    }

    // ── leads ────────────────────────────────────────────────────────────────────────────
    const LEADS = [
      ['Peter', 'Wanjala', 'Wanjala Motors', '0110234901', 'new', 'webform'],
      ['Lucy', 'Wambui', 'Wambui Hardware', '0721445533', 'contacted', 'call'],
      ['Joseph', 'Kariuki', 'Kariuki Farms', '0733990011', 'qualified', 'manual'],
      ['Esther', 'Nyambura', null, '0100223344', 'new', 'chat'],
      ['Michael', 'Omondi', 'Omondi Spares', '0712009988', 'unqualified', 'webform'],
    ] as const;
    for (const [i, [firstName, lastName, companyName, phone, status, source]] of LEADS.entries()) {
      const found = await db.lead.findFirst({
        where: { firstName, lastName },
        select: { id: true },
      });
      if (found) continue;
      await db.lead.create({
        data: {
          id: uuidv7(),
          firstName,
          lastName,
          companyName,
          phoneE164: `+254${phone.slice(1)}`,
          phoneRaw: phone,
          email: `${firstName.toLowerCase()}@example.co.ke`,
          source,
          status,
          ownerId: i === 0 ? null : pick(userIds, i),
          notes: i === 0 ? 'Supplier for brake pads and filters for six light trucks' : null,
          createdAt: daysAgo(i * 3 + 1),
        },
      });
    }

    // ── calls ────────────────────────────────────────────────────────────────────────────
    const dispositions = await db.callDisposition.findMany();
    const callCount = await db.call.count();
    if (callCount < 10) {
      for (let i = 0; i < 36; i++) {
        const inbound = i % 3 !== 1;
        const missed = i % 7 === 3;
        const contactId = pick(contactIds, i);
        const contact = await db.contact.findUnique({
          where: { id: contactId },
          select: { phones: { take: 1, select: { e164: true, raw: true } } },
        });
        const e164 = contact?.phones[0]?.e164 ?? '+254700000000';
        const started = hoursAgo(i * 5 + 1);
        const ring = 8 + (i % 20);
        const talk = missed ? null : 45 + i * 17;
        await db.call.create({
          data: {
            id: uuidv7(),
            pbxCallId: `demo.${String(Date.now())}.${String(i)}`,
            direction: inbound ? 'inbound' : 'outbound',
            status: missed ? 'missed' : 'completed',
            fromNumber: inbound ? e164 : '1004',
            toNumber: inbound ? '0207654321' : e164,
            externalE164: e164,
            contactId,
            userId: missed ? null : pick(userIds, i),
            extension: missed ? null : '1004',
            trunkName: 'Safaricom',
            didNumber: '0207654321',
            startedAt: started,
            answeredAt: missed ? null : new Date(started.getTime() + ring * 1000),
            endedAt: new Date(started.getTime() + (ring + (talk ?? 0)) * 1000),
            ringDurationSec: ring,
            talkDurationSec: talk,
            totalDurationSec: ring + (talk ?? 0),
            dispositionId: missed || dispositions.length === 0 ? null : pick(dispositions, i).id,
            recordingStatus: missed ? 'none' : i % 2 === 0 ? 'stored' : 'none',
          },
        });
      }
    }

    // ── tasks ────────────────────────────────────────────────────────────────────────────
    if ((await db.task.count()) < 5) {
      const TASKS = [
        ['Follow-up call', 'call', 'high', -2],
        ['Send the revised quote', 'follow_up', 'normal', 4],
        ['Site visit Kilimani', 'meeting', 'normal', 26],
        ['Chase the signed LPO', 'follow_up', 'high', -26],
        ['Email the parts catalogue', 'email', 'low', 50],
        ['Confirm delivery window', 'call', 'normal', 8],
      ] as const;
      for (const [i, [title, type, priority, dueInHours]] of TASKS.entries()) {
        await db.task.create({
          data: {
            id: uuidv7(),
            title,
            type,
            priority,
            status: i === 5 ? 'done' : 'open',
            dueAt: new Date(Date.now() + dueInHours * 3_600_000),
            assigneeId: pick(userIds, i),
            contactId: pick(contactIds, i),
            completedAt: i === 5 ? hoursAgo(3) : null,
            createdById: userIds[0] ?? null,
          },
        });
      }
    }

    // ── notes ────────────────────────────────────────────────────────────────────────────
    if ((await db.note.count()) < 3) {
      const NOTES = [
        'Wants a quote for 40 brake pads, delivery to Kilimani by Friday.',
        'Site visit done. Workshop has 6 bays; interested in a fleet servicing contract from Q4.',
        'Prefers WhatsApp over email. Calls after 16:00 usually go unanswered.',
      ];
      for (const [i, body] of NOTES.entries()) {
        await db.note.create({
          data: { id: uuidv7(), body, authorId: pick(userIds, i), contactId: pick(contactIds, i) },
        });
      }
    }

    // ── a WhatsApp channel with two conversations ────────────────────────────────────────
    let channel = await db.channel.findFirst({ where: { type: 'whatsapp' } });
    channel ??= await db.channel.create({
      data: {
        id: uuidv7(),
        type: 'whatsapp',
        name: 'WhatsApp',
        externalId: 'demo-phone-id',
        config: {},
      },
    });
    if ((await db.conversation.count()) < 2) {
      for (let i = 0; i < 3; i++) {
        const contactId = pick(contactIds, i);
        const contact = await db.contact.findUnique({
          where: { id: contactId },
          select: { phones: { take: 1, select: { e164: true } } },
        });
        const external = (contact?.phones[0]?.e164 ?? '+254700000000').replace('+', '');
        const conversationId = uuidv7();
        // the third thread's window has expired, so the composer shows the template-only state
        const lastInbound = i === 2 ? daysAgo(2) : hoursAgo(i + 1);
        await db.conversation.create({
          data: {
            id: conversationId,
            channelId: channel.id,
            externalId: external,
            contactId,
            status: 'open',
            assigneeId: i === 0 ? null : pick(userIds, i),
            lastMessageAt: lastInbound,
            lastInboundAt: lastInbound,
            unreadCount: i === 0 ? 2 : 0,
          },
        });
        for (let m = 0; m < 4; m++) {
          const inbound = m % 2 === 0;
          await db.message.create({
            data: {
              id: uuidv7(),
              conversationId,
              direction: inbound ? 'inbound' : 'outbound',
              contentType: 'text',
              body: inbound
                ? pick(WA_MESSAGES, i + m)
                : 'Yes, we deliver to Nairobi. Sending the quote now.',
              status: inbound ? 'received' : m === 3 ? 'read' : 'delivered',
              sentById: inbound ? null : pick(userIds, i),
              sentAt: new Date(lastInbound.getTime() - (4 - m) * 600_000),
              externalMessageId: `demo.${conversationId}.${String(m)}`,
            },
          });
        }
      }
    }

    // Local development only: the demo admin is meant to be signed into immediately, including by
    // the manual's screenshot script, and enrolling an authenticator every time a dev database is
    // rebuilt helps nobody. Production seeds do not touch this.
    await db.setting.upsert({
      where: { key: 'security' },
      create: {
        key: 'security',
        value: { require2FAForPrivileged: false, require2FAForAll: false, sessionIdleMinutes: 60 },
        updatedById: null,
      },
      update: {
        value: { require2FAForPrivileged: false, require2FAForAll: false, sessionIdleMinutes: 60 },
      },
    });

    const counts = {
      companies: await db.company.count(),
      contacts: await db.contact.count(),
      leads: await db.lead.count(),
      deals: await db.deal.count(),
      calls: await db.call.count(),
      tasks: await db.task.count(),
      conversations: await db.conversation.count(),
      users: await db.user.count(),
    };
    // eslint-disable-next-line no-console
    console.log('demo data ready', counts);
    // eslint-disable-next-line no-console
    console.log('sign in as  samuel.kiptoo@flare.co.ke  /  Flare-dev-2026!  (admin)');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
