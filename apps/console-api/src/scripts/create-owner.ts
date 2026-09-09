/**
 * Creates the first console owner and emails them a link to set their own password.
 *
 *   pnpm --filter @crm/console-api exec tsx src/scripts/create-owner.ts you@example.com "Your Name"
 *
 * There is no sign-up on the console, so this is how the first account comes into being. Later
 * owners are invited from the console itself.
 */
import { randomBytes } from 'node:crypto';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  // eslint-disable-next-line no-console
  console.error('Usage: create-owner.ts <email> "<name>"');
  process.exit(1);
}

const app = await buildApp({ env: loadEnv(), logger: false });
try {
  const existing = await app.db.user.findUnique({ where: { email } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`${email} already exists`);
  } else {
    const password = randomBytes(24).toString('base64url');
    const created = await app.auth.api.createUser({
      body: { email, name, password, role: 'owner' },
    });
    await app.auth.api.requestPasswordReset({
      body: { email, redirectTo: `${app.config.CONSOLE_URL}/reset-password` },
    });
    // eslint-disable-next-line no-console
    console.log(`created ${email} (${created.user.id}); a set-password email is on its way`);
  }
} finally {
  await app.close();
}
