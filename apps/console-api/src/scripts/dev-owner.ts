/**
 * Creates a console owner with a password printed to the terminal, for local work.
 *
 *   pnpm --filter @crm/console-api exec tsx src/scripts/dev-owner.ts you@example.com "Your Name"
 *
 * `create-owner.ts` is the real path: it emails a link and nobody but the owner ever knows the
 * password. That needs working SMTP, which a laptop usually does not have, so this exists to get a
 * local console usable. It refuses to run in production.
 *
 * Two-factor still applies. The account can sign in and do nothing else until an authenticator is
 * set up, exactly as it would in production.
 */
import { randomBytes } from 'node:crypto';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  // eslint-disable-next-line no-console
  console.error('Usage: dev-owner.ts <email> "<name>"');
  process.exit(1);
}

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.error('Refusing to run in production. Use create-owner.ts, which emails a link.');
  process.exit(1);
}

const app = await buildApp({ env, logger: false });
try {
  const existing = await app.db.user.findUnique({ where: { email } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`${email} already exists; delete it first if you want a new password`);
  } else {
    // Meets the console's own rule: twelve characters, mixed case, a digit.
    const password = `Dev-${randomBytes(9).toString('base64url')}-1a`;
    await app.auth.api.createUser({ body: { email, name, password, role: 'owner' } });
    await app.db.user.update({ where: { email }, data: { emailVerified: true } });
    // eslint-disable-next-line no-console
    console.log(
      `created ${email}\npassword: ${password}\nSet up an authenticator on first sign-in.`,
    );
  }
} finally {
  await app.close();
}
