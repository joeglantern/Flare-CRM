/**
 * Console seed (docs/21): a starting plan, the provider's contact details, and the first owner.
 *
 * Idempotent. The first owner gets a set-password email rather than a password chosen here, and
 * has to set up an authenticator before the console will let them do anything.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CONSOLE_SETTING_KEYS,
  DEFAULT_ALERT_THRESHOLDS,
  DEFAULT_ENTITLEMENTS,
  DEFAULT_RETENTION,
  normaliseFeatures,
} from '@crm/shared';
import { loadEnv } from '../src/config/env.js';
import { newId } from '../src/lib/ids.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const STANDARD = {
  name: 'Standard',
  description: 'Everything except the softphone and the API reference.',
  features: normaliseFeatures({
    ...DEFAULT_ENTITLEMENTS.features,
    softphone: false,
    api_docs: false,
  }),
  limits: {
    seats: 10,
    storage_gb: 20,
    recording_retention_days: 365,
    channels: 1,
    pipelines: 3,
  },
};

export async function seed(
  db: PrismaClient,
  env: { FIRST_OWNER_EMAIL?: string | undefined; FIRST_OWNER_NAME?: string | undefined },
) {
  const existing = await db.plan.findFirst({ where: { name: STANDARD.name } });
  if (!existing) {
    await db.plan.create({
      data: {
        id: newId(),
        name: STANDARD.name,
        description: STANDARD.description,
        features: STANDARD.features,
        limits: STANDARD.limits,
        isDefault: true,
      },
    });
  }

  await db.consoleSetting.upsert({
    where: { key: 'ownerContact' },
    create: {
      key: 'ownerContact',
      value: {
        name: env.FIRST_OWNER_NAME ?? 'Your provider',
        email: env.FIRST_OWNER_EMAIL ?? 'support@example.com',
      },
    },
    update: {},
  });

  // The three settings the console reads on a schedule. Seeded with what the code already defaults
  // to, so writing them changes nothing and a screen has something to show and edit.
  for (const [key, value] of [
    [CONSOLE_SETTING_KEYS.alertThresholds, DEFAULT_ALERT_THRESHOLDS],
    [CONSOLE_SETTING_KEYS.alertRecipients, { default: [], byKind: {} }],
    [CONSOLE_SETTING_KEYS.retention, DEFAULT_RETENTION],
  ] as const) {
    await db.consoleSetting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }

  return {
    plans: await db.plan.count(),
    customers: await db.customer.count(),
    owners: await db.user.count(),
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const adapter = new PrismaPg({ connectionString: env.CONSOLE_DATABASE_URL });
  const db = new PrismaClient({ adapter });
  try {
    const counts = await seed(db, env);
    // eslint-disable-next-line no-console
    console.log('console seeded', counts);
    if (counts.owners === 0) {
      // eslint-disable-next-line no-console
      console.log(
        'No owners yet. Create the first one with:\n  pnpm --filter @crm/console-api exec tsx src/scripts/create-owner.ts <email> "<name>"',
      );
    }
  } finally {
    await db.$disconnect();
  }
}

// Runs as a script, and is imported by the tests.
if (process.argv[1]?.includes('seed')) {
  await main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
