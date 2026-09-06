/**
 * Idempotent seed (docs/05 "Prisma notes"): dispositions, default pipeline, settings defaults,
 * and the first admin (from FIRST_ADMIN_EMAIL) who receives a set-password email.
 * Run: pnpm db:seed
 */
import { config as loadDotenv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { v7 as uuidv7 } from 'uuid';

loadDotenv({ path: ['../../.env', '.env'], quiet: true });

const DISPOSITIONS = [
  'Interested',
  'Follow-up',
  'No answer',
  'Not interested',
  'Wrong number',
  'Voicemail left',
];
const STAGES: { name: string; probability: number; type: 'open' | 'won' | 'lost' }[] = [
  { name: 'New', probability: 10, type: 'open' },
  { name: 'Contacted', probability: 25, type: 'open' },
  { name: 'Qualified', probability: 50, type: 'open' },
  { name: 'Proposal', probability: 75, type: 'open' },
  { name: 'Won', probability: 100, type: 'won' },
  { name: 'Lost', probability: 0, type: 'lost' },
];

export async function seed(
  db: PrismaClient,
  opts: { firstAdminEmail?: string; firstAdminName?: string },
): Promise<{ adminId: string | null }> {
  for (const [i, name] of DISPOSITIONS.entries()) {
    await db.callDisposition.upsert({
      where: { name },
      create: { id: uuidv7(), name, sortOrder: i, isSystem: true },
      update: { sortOrder: i, isSystem: true },
    });
  }

  const pipeline = await db.pipeline.upsert({
    where: { name: 'Sales' },
    create: { id: uuidv7(), name: 'Sales', isDefault: true },
    update: {},
  });
  for (const [i, s] of STAGES.entries()) {
    await db.pipelineStage.upsert({
      where: { pipelineId_name: { pipelineId: pipeline.id, name: s.name } },
      create: {
        id: uuidv7(),
        pipelineId: pipeline.id,
        name: s.name,
        sortOrder: i,
        probability: s.probability,
        type: s.type,
      },
      update: { sortOrder: i, type: s.type },
    });
  }

  let adminId: string | null = null;
  if (opts.firstAdminEmail) {
    const existing = await db.user.findUnique({ where: { email: opts.firstAdminEmail } });
    if (existing) {
      adminId = existing.id;
    } else {
      adminId = uuidv7();
      await db.user.create({
        data: {
          id: adminId,
          email: opts.firstAdminEmail,
          name: opts.firstAdminName ?? 'Administrator',
          role: 'admin',
          emailVerified: false,
          isActive: true,
        },
      });
    }
  }
  return { adminId };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const result = await seed(db, {
      ...(process.env.FIRST_ADMIN_EMAIL
        ? { firstAdminEmail: process.env.FIRST_ADMIN_EMAIL.toLowerCase() }
        : {}),
      ...(process.env.FIRST_ADMIN_NAME ? { firstAdminName: process.env.FIRST_ADMIN_NAME } : {}),
    });
    process.stdout.write(
      `seed complete${result.adminId ? ` (admin ${result.adminId}; use "Forgot password" on the login page to set a password)` : ''}\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  });
}
