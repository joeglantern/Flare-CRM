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
- **Owners.** Invite, deactivate. An invitation emails a link; nobody sets anyone else's password.
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
- **Console to stack:** `entitlements` (envelope and issue id), `announce`, `ping`.
- **Console to owner browsers**, on the default namespace: `fleet:stack` and `issue:status`.
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

## 5. Domains

Every customer gets `<slug>.<brand domain>`. A customer who wants their own domain publishes two
records:

- `CNAME crm.theircompany.co.ke → <slug>.<brand domain>`
- `TXT _flare-verify.crm.theircompany.co.ke → <token from the console>`

The console checks both. The CNAME alone is not enough: anyone can point a name at us. Once
verified, one command is re-run on the customer's server with the domain in `--extra-domains`, and
Caddy asks for that certificate. That last step is a command rather than a button because a
container cannot rewrite the web server in front of it (docs/08 §N).

## 6. Deployment

`infra/console/` holds the compose stack: Caddy, the api, Postgres, Valkey, a client publisher and
a nightly `pg_dump`. Same hardening rules as a customer stack (docs/12 §1): read-only containers,
all capabilities dropped, no new privileges, capped logs, internal network for the data services.

```
cp .env.example .env         # fill in, generate the three keys as the comments say
IMAGE_TAG=<git-sha> ./deploy.sh
docker compose run --rm create-owner you@example.com "Your Name"
```

The signing key is the one irreplaceable thing on that machine. Losing it means every customer has
to be issued a document signed by a new key before they trust anything from the console again; the
fleet screen shows who has not applied one yet. Back up `/opt/flare-console/.env` with the database
(docs/13).

## 7. On the same host as a customer stack

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

While that is the way in, set `CONSOLE_URL=http://localhost:8081` in the console's `.env`: it is what
password and invitation emails are built from, and a link to a name that does not resolve is no
link. Put the real name back, and delete the overlay and its conf.d file, once DNS exists.

What this costs: the signing key sits on the same machine as a customer's data, so one compromise
is two losses. It also means the console goes down when that machine does, including when the
console is the thing you would use to see why. Both are reasons to move it to its own VPS once
there is more than one customer; the compose stack is the same either way, and moving is the volume
and the `.env`.

## 8. Local development

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
