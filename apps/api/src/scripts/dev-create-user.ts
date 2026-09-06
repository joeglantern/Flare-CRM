/**
 * Local development only: creates a user with a known password so the web client can be exercised
 * without the welcome-email flow. Refuses to run in production.
 *
 *   pnpm --filter @crm/api dev:user -- agent@flare.local "Faith Chebet" agent 1001 [password]
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from 'better-auth/crypto';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { isRoleName } from '@crm/shared';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

async function main(): Promise<void> {
  const env = loadEnv({ ...process.env, LOG_LEVEL: 'silent' });
  if (env.NODE_ENV === 'production') throw new Error('dev-create-user must not run in production');
  const [email, name, role = 'agent', extension, passwordArg] = process.argv
    .slice(2)
    .filter((a) => a !== '--');
  if (!email || !name)
    throw new Error('usage: dev:user -- <email> <name> [role] [extension] [password]');
  if (!isRoleName(role)) throw new Error(`role must be admin, manager or agent (got ${role})`);
  const password = passwordArg ?? `Dev-${randomBytes(6).toString('base64url')}`;

  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL_MIGRATE ?? env.DATABASE_URL,
    }),
  });
  try {
    const existing = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    const id = existing?.id ?? uuidv7();
    const now = new Date();
    if (!existing) {
      await db.user.create({
        data: {
          id,
          email: email.toLowerCase(),
          name,
          role,
          emailVerified: true,
          isActive: true,
          extension: extension ?? null,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    const hash = await hashPassword(password);
    await db.account.upsert({
      where: { issuer_accountId: { issuer: 'local:credential', accountId: id } },
      create: {
        id: uuidv7(),
        userId: id,
        accountId: id,
        providerId: 'credential',
        issuer: 'local:credential',
        password: hash,
        createdAt: now,
        updatedAt: now,
      },
      update: { password: hash, updatedAt: now },
    });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          id,
          email: email.toLowerCase(),
          role,
          extension: extension ?? null,
          password,
          created: !existing,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
