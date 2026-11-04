/**
 * Clears an owner's second factor from the server, for when no owner can sign in to do it from the
 * Owners screen.
 *
 *   docker compose run --rm reset-owner-two-factor you@example.com
 *
 * It is the same reset as the button: their sessions end, they are emailed, and an audit row is
 * written, as a system action because no owner did this. Access to the server is the permission.
 */
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';

const [email] = process.argv.slice(2);
if (!email) {
  // eslint-disable-next-line no-console
  console.error('Usage: reset-owner-two-factor.ts <email>');
  process.exit(1);
}

const app = await buildApp({ env: loadEnv(), logger: false });
try {
  const owner = await app.db.user.findUnique({ where: { email } });
  if (!owner) {
    // eslint-disable-next-line no-console
    console.error(`No console account uses ${email}`);
    process.exitCode = 1;
  } else {
    await app.owners.resetTwoFactor(owner.id, { actorId: null, actorType: 'system' });
    // eslint-disable-next-line no-console
    console.log(`two-factor reset for ${email}; they set up a new authenticator at next sign-in`);
  }
} finally {
  await app.close();
}
