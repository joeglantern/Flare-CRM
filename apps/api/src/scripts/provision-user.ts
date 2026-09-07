/**
 * Creates or updates a user and sets its password, for bootstrapping a deployment before anyone
 * can sign in. The dev script next to this one refuses to run in production on purpose; this is
 * the supported way to do it on a server.
 *
 *   PROVISION_PASSWORD='...' node dist/provision-user.js <email> <name> [role] [extension]
 *
 * The password comes from the environment rather than an argument so it does not appear in shell
 * history or in the process list of anyone else on the machine. Re-running against an existing
 * email updates the name, role and password rather than creating a duplicate.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from 'better-auth/crypto';
import { v7 as uuidv7 } from 'uuid';
import { isRoleName } from '@crm/shared';
import { PrismaClient } from '../generated/prisma/client.js';

async function main(): Promise<void> {
  const [email, name, role = 'agent', extension] = process.argv.slice(2).filter((a) => a !== '--');
  if (!email || !name) {
    throw new Error('usage: provision-user <email> <name> [role] [extension]');
  }
  if (!isRoleName(role)) throw new Error(`role must be admin, manager or agent (got ${role})`);

  const password = process.env.PROVISION_PASSWORD;
  if (!password) throw new Error('PROVISION_PASSWORD is required');
  if (password.length < 12) {
    process.stderr.write('warning: password is shorter than 12 characters\n');
  }

  // Migrations own the schema, so use that role when it is available and fall back otherwise.
  const connectionString = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const lower = email.toLowerCase();
    const existing = await db.user.findUnique({ where: { email: lower }, select: { id: true } });
    const id = existing?.id ?? uuidv7();
    const now = new Date();

    if (existing) {
      await db.user.update({
        where: { id },
        data: { name, role, emailVerified: true, isActive: true, updatedAt: now },
      });
    } else {
      await db.user.create({
        data: {
          id,
          email: lower,
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

    // The password is deliberately not echoed back.
    process.stdout.write(
      `${existing ? 'updated' : 'created'} ${lower} as ${role}${extension ? ` extension ${extension}` : ''}\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
