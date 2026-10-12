# Render Free, Neon Free and Vercel

The frontend is https://stablecoin-gateway.vercel.app. The backend at https://stablecoin-gateway-api.onrender.com runs the API
and worker together on one Render Free web service in Oregon. Neon Free hosts
PostgreSQL 18 in AWS us-west-2. Both event payloads and per-consumer delivery,
retry and dead-letter state live in PostgreSQL (`EVENT_BROKER=postgres`), so
Render restarts do not discard the event queue. Local development continues
using Redis by default.

## Deployment

Use Node.js 22 and pnpm 9.12.3. `render.yaml` documents the service configuration.
The build installs the frozen lockfile and builds the API/worker dependency
graph. `scripts/start-render.mjs` loads `/etc/secrets/gateway.env`, starts both
processes, forwards termination signals and exits if either process fails.
Only the API listens on Render's public port; worker control stays on loopback.

Upload credentials as a Render secret file named `gateway.env`. Include the
Neon `DATABASE_URL`, existing wallet mnemonic, admin key, RPC URLs, Alchemy
webhook IDs/signing keys, treasury configuration and Paystack test key. Keep
secret files and backups outside Git. Preserve existing wallet configuration
when redeploying. Deployment does not switch Paystack to live mode.

Configure Vercel's API proxy with the actual Render HTTPS origin:

```sh
node scripts/configure-vercel-api.mjs https://stablecoin-gateway-api.onrender.com
vercel deploy --prod
```

Both Alchemy Address Activity webhooks must point to the backend's
`/api/webhooks/alchemy`, retaining their IDs and signing keys. Check direct and
proxied `/api/system/health`: database and worker must both be up. Verify bank
listing and authenticated read-only admin access. Do not execute a payout or
broadcast a transaction just to test hosting.

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

## Free-tier limits and recovery

Render Free sleeps after 15 minutes without inbound traffic; the next request
wakes it, usually taking about a minute. Background processing pauses while
asleep. Neon retains database/queue state across these pauses, subject to its
free compute and storage quotas. Free hosting is suitable for demos and does
not provide uninterrupted payment processing. Do not add keepalive loops to
bypass hosting limits.

Retain encrypted database backups outside the hosting provider and keep the
wallet mnemonic securely backed up. Never rerun the initial database import
against a database already accepting payments. Restore backups into a separate
empty database and verify counts, sequences and queue state before cutover.

The unused Fly gateway apps, Redis volume and managed PostgreSQL cluster were
removed on 12 October 2026. No Oracle resources were provisioned.

References: [Render Free](https://render.com/docs/free),
[Neon pricing](https://neon.com/pricing),
[Render secret files](https://render.com/docs/configure-environment-variables).
