/**
 * Signs and sends a customer's entitlements document from the command line, optionally moving them
 * onto a named plan first.
 *
 *   docker compose run --rm issue-document <slug> ["<Plan name>"]
 *
 * The console screens do this properly, with an owner's name against it. This exists for the same
 * case the register script does: the provider's own stack, which has to be served on a console
 * nobody has finished setting up an account to sign in with. It is recorded as a system action, so
 * the audit log says a machine did it rather than pretending somebody did.
 *
 * One document is signed per stack the customer has that is not revoked. A stack that is connected
 * receives it now; a stack that is not keeps it waiting and collects it the next time it connects.
 */
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { readOwnerContact } from '../lib/owner-contact.js';

const [slug, planName] = process.argv.slice(2);
const say = (line: string): void => {
  // eslint-disable-next-line no-console
  console.log(line);
};
// Annotated on the declaration, which is what lets the compiler treat a call as the end of the road.
const fail: (line: string) => never = (line) => {
  // eslint-disable-next-line no-console
  console.error(line);
  process.exit(1);
};

if (!slug) {
  fail('Usage: issue-document.ts <slug> ["<Plan name>"]');
}

const app = await buildApp({ env: loadEnv(), logger: false });
const ctx = { actorId: null, actorType: 'system' as const };
try {
  const customer = await app.db.customer.findUnique({
    where: { slug },
    include: { entitlement: true },
  });
  if (!customer) fail(`No customer with the slug ${slug}`);

  if (planName !== undefined) {
    const plan = await app.db.plan.findFirst({ where: { name: planName } });
    if (!plan) {
      const names = (await app.db.plan.findMany({ select: { name: true } })).map((p) => p.name);
      fail(`No plan called ${planName}. There is: ${names.join(', ')}`);
    }
    if (customer.entitlement?.planId === plan.id) {
      say(`${customer.name} is already on ${plan.name}`);
    } else {
      await app.db.customerEntitlement.upsert({
        where: { customerId: customer.id },
        create: { customerId: customer.id, planId: plan.id },
        update: { planId: plan.id },
      });
      await app.audit.write(ctx, {
        action: 'entitlement.update',
        entity: 'customer',
        entityId: customer.id,
        before: { planId: customer.entitlement?.planId ?? null },
        after: { planId: plan.id, by: 'issue-document script' },
      });
      say(`${customer.name} moved to ${plan.name}`);
    }
  }

  const effective = await app.entitlements.effective(customer.id);
  const issued = await app.entitlements.issue(customer.id, null, await readOwnerContact(app.db));
  if (issued.length === 0) {
    fail(`${customer.name} has no stack registered, so there is nothing to address a document to`);
  }
  await app.audit.write(ctx, {
    action: 'entitlement.issue',
    entity: 'customer',
    entityId: customer.id,
    after: {
      issues: issued.map((i) => ({ issueId: i.issueId, stackId: i.stackId })),
      by: 'issue-document script',
    },
  });
  await app.link.deliver(issued);

  const rows = await app.db.entitlementIssue.findMany({
    where: { id: { in: issued.map((i) => i.issueId) } },
    orderBy: { stackId: 'asc' },
  });
  say('');
  say(`Issued ${effective.plan?.name ?? 'no plan'} to ${customer.name}.`);
  say(`Expires: ${effective.expiresAt ?? 'never'}`);
  say(`Seats: ${String(effective.limits.seats ?? 'unlimited')}`);
  say('');
  for (const row of rows) {
    const state =
      row.status === 'delivered'
        ? 'sent, waiting for the stack to acknowledge'
        : 'waiting, and goes out the next time that stack connects';
    say(`  ${row.stackId}  ${state}`);
  }
} finally {
  await app.close();
}
