# 21. The owner console

A separate service, on a separate machine, with a separate database. It holds the customers, the
plans and what each customer is entitled to, and it is the only place an entitlements document is
signed. It never sees a customer's contacts, calls or messages.

It exists because a customer's own administrator holds every permission inside their CRM by
construction (docs/07). What they may use therefore cannot be a permission; it has to come from
outside, signed, and be read-only where it lands.

## 1. Shape

| Piece              | Where                     | What it is                                        |
| ------------------ | ------------------------- | ------------------------------------------------- |
| `apps/console-api` | its own VPS               | Fastify, Prisma, Postgres, Valkey, Socket.IO      |
| `apps/console-web` | same VPS, served by Caddy | Vite, React, TanStack Router and Query, `@crm/ui` |
| `infra/console`    | that VPS                  | compose stack, Caddyfile, deploy script           |

One role: `owner`. Everyone who can sign in here can do everything here, because the people who
sign in here are the provider. Two-factor is required of every account; the only routes reachable
without it are the ones that set it up.

Sessions are eight hours, not the CRM's twelve. The cookie prefix is `flarecon`, distinct from the
CRM's, so a browser open on both never confuses the two.

## 2. What an owner does

- **Fleet.** Every customer, their plan, whether their stack is reporting in, seats and storage in
  use, the version they are running, when they last backed up, and when their plan expires. Rows
  update from the socket, not from polling.
- **Customer.** Contact details; the two domains and the DNS checks behind verifying the second;
  stack credentials, shown once; entitlements; announcements; and the history of every document
  issued.
- **Plans.** The shapes a customer can be sold, so a per-customer override is the exception.
- **Owners.** Invite, deactivate, reactivate, end somebody's sessions, and clear somebody's second
  factor. An invitation emails a link; nobody sets anyone else's password. The reset exists because
  there is nobody above an owner here: without it, an owner who loses their phone and their backup
  codes is locked out for good. It clears the second factor and their sessions together, since an
  account that can no longer prove a second factor should not keep the sessions that already did.
- **Overview.** The fleet as numbers over time: how many customers are live, seats and storage used
  against sold, monthly revenue, plan mix, versions in the field, what expires soon, and whatever is
  currently worth looking at (§8).
- **Audit.** Everything anyone did here, append-only at the database level.
- **Settings.** The support contact carried inside every document, the brand domain, and the
  signing key's fingerprint and public half.

Saving what a customer is entitled to and issuing it are two steps. Saving records what was agreed;
issuing signs it and sends it. An owner mid-negotiation should not be changing what a live CRM
allows on every keystroke.

## 3. The link

A stack dials out; the console never reaches in. That is what lets a customer keep their firewall
shut, and it is why the console learns how a stack is doing only because the stack tells it.

- **Namespace** `/link` on the console's Socket.IO server. Authentication is
  `{ stackId, secret, protocol: 1 }` in the handshake, checked against a hash. Revoked stacks are
  refused. The newest connection for a stack wins; the previous one is dropped.
- **Stack to console:** `hello` (version, domain, uptime, the document it holds), `heartbeat` every
  thirty seconds (readiness, usage, last backup, the document it holds), `ack` (applied or
  rejected, with a reason).
- **Console to stack:** `entitlements` (envelope and issue id), `announce`, `ping`, and `command`
  (a support action, §9).
- **Stack to console, answering that:** `commandResult`.
- **Console to owner browsers**, on the default namespace: `fleet:stack`, `issue:status` and
  `alert:changed`.
- **Rate:** five events a second per stack; a stack that exceeds it is disconnected.
- **Staleness:** a stack that has not been heard from in ninety seconds is marked disconnected by a
  sweeper, so a process that died without a clean disconnect does not sit there looking healthy.

Two REST endpoints carry the same document for a stack whose socket is not up yet, authenticated by
`Authorization: Bearer <stackId>.<secret>`:

- `GET /api/link/entitlements` → the newest outstanding document, or 204.
- `POST /api/link/ack` → what the stack did with it.

Only one worker replica holds the connection, chosen by a Valkey leader lock (`console:leader`),
the same pattern the PBX subscriber uses.

## 4. Stack credentials

Created from the customer's screen. The console returns the four environment lines once:

```
CONSOLE_URL=https://console.raniafrica.co.ke
CONSOLE_STACK_ID=stk_…
CONSOLE_STACK_SECRET=…
CONSOLE_PUBLIC_KEY=MCowBQ…
```

The secret is stored only as a hash. Rotating issues a new secret for the same id and drops the
live connection; revoking refuses the stack altogether. Neither touches the customer's data: a
revoked stack keeps running on whatever document it last applied.

## 5. Suspension, and what it actually does

A status column tells the provider something. It tells the customer's own server nothing, and the
customer's server is where the writing happens.

So setting a customer to anything other than active does two things: it records the status, and it
reissues their document with an expiry of now. An expired document is already understood by every
stack as read only (docs/20 §5): everything can be read, nothing can be written, and the person
using it is told why rather than shown a broken screen. Nothing is deleted and nothing is hidden.

Whatever the expiry was before is kept, so lifting the suspension gives back exactly that date
rather than an unlimited one. Suspending twice keeps the first record. If the stack is offline when
this happens, it collects the document the moment it comes back, the same way it collects any other.

## 6. Domains

Every customer gets `<slug>.<brand domain>`. A customer who wants their own domain publishes two
records:

- `CNAME crm.theircompany.co.ke → <slug>.<brand domain>`
- `TXT _flare-verify.crm.theircompany.co.ke → <token from the console>`

The console checks both. The CNAME alone is not enough: anyone can point a name at us. Once
verified, one command is re-run on the customer's server with the domain in `--extra-domains`, and
Caddy asks for that certificate. That last step is a command rather than a button because a
container cannot rewrite the web server in front of it (docs/08 §N).

## 7. Prices, and what the console counts as revenue

A plan carries `priceMonthlyMinor` and a currency, and a customer may carry an override when what
they actually pay differs from the shelf price. Both are minor units, integers, never floats: a
price is money, and money in a float is a rounding error waiting for a quarterly report.

Monthly recurring revenue is the sum of what active, unexpired customers pay. There is no billing
here and no invoices: the console records what was agreed so it can say what is at risk when a plan
is about to expire, and nothing more.

## 8. What is recorded, what is charted, and what is watched

A heartbeat used to overwrite one row per stack, which meant the console could say how things were
and never how they had been. Three tables fix that, each one cheaper than the last:

| Table           | One row per         | Written by                    | Kept     |
| --------------- | ------------------- | ----------------------------- | -------- |
| `stack_samples` | stack, five minutes | the heartbeat handler         | 30 days  |
| `stack_days`    | stack, day          | the rollup, every ten minutes | 400 days |
| `fleet_days`    | day                 | the same rollup               | forever  |

Beats arrive every thirty seconds; one in ten is kept, gated by a Valkey `SET NX PX 300000` so the
decision costs one Valkey write rather than a query. Days are bucketed in `Africa/Nairobi`, so a
day means what the owner means by it. `connected_minutes` is inferred from how many samples arrived
rather than from connection events, because a stack that reported in was, by definition, up.

The fleet row is a snapshot, not a recomputation: seats sold and revenue are written as they stand
that day and never backfilled, so changing a price tomorrow does not quietly rewrite last month.

Three endpoints read them, all `analytics:read`, all returning dense series with every day present:
`/analytics/overview`, `/analytics/customers/:id` and `/analytics/revenue`. A projection is only
returned when there are at least seven points, growth is positive and a cap exists; otherwise it is
null, because a straight line through two points is a guess wearing a chart's clothes.

**Alerts.** A sweep every five minutes opens one row per finding and closes it when the finding goes
away. One open row per kind per customer is the deduplication, so a stack that is offline all day is
one alert and not two thousand emails. The kinds are stack offline (10 minutes), stack unhealthy
(15), storage or seats past 80 percent and at 100, plan expiring within 14 days, plan expired, a
backup older than 48 hours, and a document a stack refused. The row is the record; the email is a
consequence of it, and a mail server that is down does not lose the alert.

All of this runs on one interval behind a Valkey leader lock (`console:scheduler`), not a queue: the
console is one process doing a few things on a schedule, and BullMQ would be a second system to run.

## 9. Support: reaching into a customer's CRM

A customer's only administrator loses their phone. Nobody inside their company can help them, and
the provider is the only one who can. This is the channel for that, and it is deliberately narrow.

Three actions, and the list is closed: list who can sign in there, clear one person's second factor,
end one person's sessions. Nothing reads a contact, a call, a message or a deal. Nothing creates an
account or changes what anybody may do.

- The console audits the request before it is sent and the answer when it comes back. The listing
  itself is not stored, only how many people were in it: they are the customer's staff, and we only
  needed to look.
- The stack audits it again in the customer's own log, as a system action naming the provider and
  the reason given, so their administrator sees what we did without having to ask us.
- A command only reaches a stack that is connected right now, and times out in ten seconds. There is
  no queue: a support action that lands an hour later, after the conversation has moved on, is worse
  than one that fails.
- A stack that was never given the support wiring refuses every command, whatever the console says.

## 10. Deployment

`infra/console/` holds the compose stack: Caddy, the api, Postgres, Valkey, a client publisher and
a nightly `pg_dump`. Same hardening rules as a customer stack (docs/12 §1): read-only containers,
all capabilities dropped, no new privileges, capped logs, internal network for the data services.

```
cp .env.example .env         # fill in, generate the three keys as the comments say
IMAGE_TAG=<git-sha> ./deploy.sh
docker compose run --rm create-owner you@example.com "Your Name"
```

Customers are created from the screens. The one exception is the provider's own stack on a console
nobody can sign in to yet, which has a script for it; it records itself as a system action rather
than putting an owner's name on something an owner did not do:

```
docker compose run --rm register-customer <slug> "<Name>" "<Contact name>" <contact email>
```

The signing key is the one irreplaceable thing on that machine. Losing it means every customer has
to be issued a document signed by a new key before they trust anything from the console again; the
fleet screen shows who has not applied one yet. Back up `/opt/flare-console/.env` with the database
(docs/13).

## 11. On the same host as a customer stack

For a first console, before it earns a machine of its own, it can share one with a customer stack.
Two containers more, about 300 MB, and no second web server.

Port 443 belongs to the customer stack's Caddy, so that Caddy serves the console as an extra site.
Its Caddyfile ends with `import /etc/caddy/conf.d/*.caddy`, which is empty on an ordinary customer
stack; here it holds `console.caddy`. The console's api publishes on the host's loopback and on the
Docker bridge gateway rather than joining the customer stack's network: two compose projects both
call their backend `api`, and one name answered by two containers is exactly the sort of fault that
shows up at three in the morning. Both bindings are host-local; a plain `4100:4100` would be open to
the internet whatever the host firewall says, because Docker writes its own iptables rules.

```
# once: the console's own directory, secrets, and .env
cd ~/flare-crm/infra/console
cp .env.example .env            # CONSOLE_DOMAIN, the three keys, BUILD_LOCALLY=1
cp same-host/console.caddy ../docker/caddy/conf.d/
echo 'CONSOLE_DOMAIN=console.example.com' >> ../docker/.env

# the console, without a Caddy of its own
BUILD_LOCALLY=1 ./deploy.sh --shared-caddy

# the customer stack's Caddy, now serving both sites
cd ../docker
docker compose -f compose.yml -f ../console/same-host/crm-caddy.yml up -d caddy
```

The console needs its own hostname pointed at that machine before a certificate can be issued. Until
that record exists, Caddy retries and the customer's site is unaffected; the certificate appears on
its own within a minute of the record resolving.

You do not have to wait for it to start using the console. A third overlay serves it on port 8081
without TLS, published on the host's loopback and nowhere else, so an SSH tunnel is the only way in:

```
cp same-host/console-tunnel.caddy ../docker/caddy/conf.d/
cd ../docker
docker compose -f compose.yml -f ../console/same-host/crm-caddy.yml   -f ../console/same-host/console-tunnel.yml up -d caddy

# from your own machine
ssh -i <key> -L 8081:127.0.0.1:8081 <user>@<host>   # leave it running
open http://localhost:8081
```

`CONSOLE_URL` stays the real name: the console refuses a plain-http one in production, which is the
rule doing its job. Add the tunnel to `DEV_ORIGINS` instead, which is what the CORS and CSRF checks
read alongside `CONSOLE_URL`:

```
DEV_ORIGINS=http://localhost:8081,http://127.0.0.1:8081
```

One consequence to know about: password and invitation emails are built from `CONSOLE_URL`, so their
links point at the name that does not resolve yet. Copy the token out of the link and open
`http://localhost:8081/reset-password?token=…` through the tunnel. Links last fifteen minutes;
"Forgotten your password?" on the tunnel sends another.

Delete the overlay, its conf.d file and the `DEV_ORIGINS` line once DNS exists.

What this costs: the signing key sits on the same machine as a customer's data, so one compromise
is two losses. It also means the console goes down when that machine does, including when the
console is the thing you would use to see why. Both are reasons to move it to its own VPS once
there is more than one customer; the compose stack is the same either way, and moving is the volume
and the `.env`.

## 12. Local development

```
pnpm dev:console         # api on 4100
pnpm dev:console-web     # client on 5174, proxying to it
pnpm --filter @crm/console-api exec tsx src/scripts/dev-owner.ts you@example.com "Your Name"
```

`dev-owner` prints a password because the real path emails a link and a laptop rarely has SMTP. It
refuses to run in production. Two-factor still applies: the account can sign in and do nothing else
until an authenticator is set up.

To watch the whole loop, create a customer and a stack in the console, paste the four lines into
the repo's `.env`, and start the worker. The fleet row turns live within a heartbeat, and switching
a feature off reaches the CRM in under a second.
