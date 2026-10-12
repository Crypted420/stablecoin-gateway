# Fly.io, Neon Free and Vercel

The frontend is https://stablecoin-gateway.vercel.app. The backend is
https://stablecoin-gateway-api-crumbs.fly.dev. One Fly Machine in Ashburn (`iad`)
runs the API and worker together with one shared CPU and 512 MB RAM. Neon Free
retains PostgreSQL 18 in AWS us-west-2. Event payloads and per-consumer delivery,
retry and dead-letter state live in PostgreSQL (`EVENT_BROKER=postgres`). Local
development continues using Redis by default. No Fly database, Redis service,
persistent volume or paid dedicated IPv4 address is required.

## Deployment

Use Node.js 22 and pnpm 9.12.3. `fly.toml` selects the Docker `app` target,
shared 512 MB Machine and combined process supervisor. `scripts/start-server.mjs`
starts both processes, forwards termination signals and exits if either fails.
Only the API listens on port 4000; worker control stays on loopback. HTTPS is
required at the edge and in the API. Health checks explicitly forward the
HTTPS protocol and require both the database and worker to be healthy.

Keep the existing Neon URL, wallet mnemonic, admin key, RPC URLs, Alchemy IDs
and signing keys, treasury configuration and the current Paystack live key in Fly secrets.
Never include credentials in the Docker build context or Git. Preserve wallet
configuration on every redeploy. Preserve the deployed Paystack key; local test
credentials must not overwrite the live secret.

Deploy exactly one Machine; Fly otherwise creates a spare by default:

```sh
fly deploy --ha=false
node scripts/configure-vercel-api.mjs https://stablecoin-gateway-api-crumbs.fly.dev
vercel deploy --prod
```

Both Alchemy Address Activity webhooks must point to
`https://stablecoin-gateway-api-crumbs.fly.dev/api/webhooks/alchemy`, retaining
their IDs and signing keys. Check direct and proxied `/api/system/health`, bank
listing and authenticated read-only admin access. Do not execute a payout or
broadcast a transaction just to test hosting.

## Cutover from Render

The same Neon database is used by both hosts, so no second database import is
needed. Take a private backup and record table counts and wallet derivation
sequence before cutover. Build the Fly image first, suspend the Render service,
then deploy Fly, verify health, switch Vercel and Alchemy and verify public
requests. Keep Render suspended to prevent duplicate workers. Rollback requires
stopping Fly before resuming Render and restoring the previous API routes and
webhook URLs. `render.yaml` and `scripts/start-render.mjs` remain as fallback
configuration; normal deployments use Fly.

## Initial data migration

Stop the local API and worker before the final snapshot and keep them stopped
after cutover. Separate databases sharing one wallet can allocate duplicate
invoice addresses if both remain active.

Use a PostgreSQL 18 `pg_dump` with `--no-owner --no-acl` and restore into a new,
empty Neon database in one transaction. Preserve all tables and sequences,
including `invoice_derivation_seq`. Apply migration 009 after restoring the
existing migrations. Compare all table counts and sequence state before
starting the hosted worker.

When migrating from Redis, copy the event stream in order and translate each
consumer group's last-delivered ID and pending entries into broker delivery
rows. Mark already acknowledged entries acknowledged, retain pending retries
and dead letters, and leave unseen events unclaimed. Do not replay the entire
historical outbox: that could reprocess a settlement awaiting approval.

The initial snapshot contains 2 merchants, 65 invoices, 65 payments and 65
settlements. One settlement is awaiting approval. Private migration backups
are retained locally outside the repository.

## Costs, quotas and recovery

The Fly Machine automatically stops after several minutes of idle HTTP traffic
and starts again for incoming API or Alchemy webhook requests. `fly.toml` sets
`auto_stop_machines = "stop"`, `auto_start_machines = true` and
`min_machines_running = 0`. The API and worker share this Machine, so background
confirmation checks, queued retries and settlement processing pause while it is
stopped and resume after it wakes. The first request may take longer during
startup. Continuous frontend polling or other HTTP traffic can keep it running.

List-price compute for this size in Ashburn is
$3.69 per 30 days of continuous runtime, plus traffic and any other metered
resources. The database remains on Neon Free; no managed Fly Postgres exists.
Do not add extra Machines, volumes or dedicated IPv4 addresses without reviewing
costs.

Neon Free allows 100 CU-hours per project per month. The fixed 0.25 CU database
therefore has about 400 active hours per month. The worker polls continuously
and health checks query the database while the Fly Machine runs, so the database
can remain active during that time. Idle auto-stop allows it to become inactive
between requests. This free quota does not cover a full month of uninterrupted
database operation; service can pause when the quota is exhausted. Review Neon
usage before depending on uninterrupted payment processing. No paid Neon upgrade
is part of this deployment.

Retain encrypted database backups outside the provider and keep the wallet
mnemonic securely backed up. Never rerun the initial database import against a
database already accepting payments. Restore backups into a separate empty
database and verify counts, sequences and queue state before cutover.

The earlier Fly managed PostgreSQL cluster and Redis volume were removed on
12 October 2026. No Oracle resources were provisioned.

References: [Fly pricing](https://fly.io/docs/about/pricing/),
[Fly autostop](https://fly.io/docs/reference/fly-proxy-autostop-autostart/),
[Neon Free compute](https://neon.com/blog/neon-free-plan-1-gb-per-project).
