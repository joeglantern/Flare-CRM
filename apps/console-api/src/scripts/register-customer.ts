/**
 * Registers a customer and their first stack from the command line, and prints the four lines
 * their server needs.
 *
 *   docker compose run --rm register-customer <slug> "<Name>" "<Contact name>" <contact email>
 *
 * The console screens do this properly, with an owner's name against it. This exists for the one
 * case they cannot cover: the provider's own stack, on a fresh console, before anybody has
 * finished setting up an account to sign in with. It is recorded as a system action, so the audit
 * log says a machine did it rather than pretending somebody did.
 *
 * It refuses a slug that already exists rather than making a second customer that looks like the
 * first one.
 */
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { newId } from '../lib/ids.js';

const [slug, name, contactName, contactEmail] = process.argv.slice(2);
const say = (line: string): void => {
  // eslint-disable-next-line no-console
  console.log(line);
};

if (!slug || !name || !contactName || !contactEmail) {
  // eslint-disable-next-line no-console
  console.error('Usage: register-customer.ts <slug> "<Name>" "<Contact name>" <contact email>');
  process.exit(1);
}

const app = await buildApp({ env: loadEnv(), logger: false });
try {
  const existing = await app.db.customer.findUnique({ where: { slug } });
  if (existing) {
    say(`${slug} already exists (${existing.id}); nothing was changed`);
  } else {
    const plan = await app.db.plan.findFirst({ where: { isDefault: true } });
    const customer = await app.db.customer.create({
      data: {
        id: newId(),
        name,
        slug,
        contactName,
        contactEmail,
        primaryDomain: `${slug}.${app.config.CONSOLE_BRAND_DOMAIN}`,
        entitlement: { create: { planId: plan?.id ?? null } },
      },
    });
    const stack = await app.stacks.create(customer.id, 'primary');
    const ctx = { actorId: null, actorType: 'system' as const };
    await app.audit.write(ctx, {
      action: 'customer.create',
      entity: 'customer',
      entityId: customer.id,
      after: { name, slug, planId: plan?.id ?? null, by: 'register-customer script' },
    });
    await app.audit.write(ctx, {
      action: 'stack.create',
      entity: 'stack',
      entityId: stack.stackId,
      after: { customerId: customer.id, label: 'primary', by: 'register-customer script' },
    });
    say(`created ${name} (${customer.id}) on plan ${plan?.name ?? 'none'}`);
    say('');
    say('Put these four lines in that server\u2019s .env and restart its worker.');
    say('The secret is printed here and nowhere else; rotate it from the console if it is lost.');
    say('');
    for (const line of stack.envLines) say(`  ${line}`);
  }
} finally {
  await app.close();
}
