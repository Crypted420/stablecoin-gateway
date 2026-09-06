# Stablecoin Payment Gateway

A proof-of-concept payment gateway for Polygon and BNB Smart Chain. It creates a
unique wallet address for every invoice, detects an ERC-20 payment, waits for
confirmation, obtains the naira quote, submits the Paystack payout, records the
double-entry ledger and allows deposited tokens to be swept to a treasury.

The simplest way to run the project on Windows is with Docker Desktop. Docker
starts the web dashboard, API, worker, PostgreSQL and Redis and applies database
migrations automatically. No Node.js, pnpm, PostgreSQL or Redis installation is
needed on the Windows computer.

> **Real-money warning:** the gateway uses real Polygon and BSC networks. Use a
> Paystack **test** key and small amounts while learning. A live Paystack key can
> cause real naira transfers. Never put a personal wallet recovery phrase in
> this project.

## Windows quick start

### 1. Install Docker Desktop

Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/).
Accept the WSL 2 option if the installer asks, restart Windows if required, then
open Docker Desktop and wait until it reports that the Docker engine is running.

Docker Desktop is the only program required to run the project. Git is optional
if the project was received as a ZIP file.

### 2. Put the project on the computer

Extract the project ZIP, or clone it with Git. Avoid placing it inside OneDrive
because synchronized folders can make Docker builds unnecessarily slow.

Open the `stablecoin-gateway` folder. It must contain `docker-compose.yml`,
`Dockerfile`, `.env.example` and `start-gateway.cmd`.

### 3. Create the configuration

Double-click `start-gateway.cmd`.

On the first run it creates `.env`, opens that file in Notepad and then stops.
Complete the settings marked `REQUIRED`, save the file and close Notepad. The
minimum useful configuration is:

```dotenv
ADMIN_API_KEY=choose-a-long-private-random-value
WALLET_MNEMONIC=the twelve or twenty four words from a new dedicated wallet

CHAIN_DETECTION_MODE=rpc
POLYGON_RPC_URL=https://your-polygon-https-rpc-url
BSC_RPC_URL=https://your-bsc-https-rpc-url

PAYSTACK_SECRET_KEY=sk_test_your_paystack_test_key
```

Important details:

- `WALLET_MNEMONIC` must belong to a new wallet created only for this project.
  The invoice addresses are derived from it, so back it up securely. Whoever has
  these words can move every token deposited into those addresses.
- Use HTTPS RPC URLs, not WebSocket URLs. The gateway does not require WS URLs.
- `PAYSTACK_SECRET_KEY` supplies the bank list, resolves account names and
  processes payouts. Start with an `sk_test_...` key.
- `ADMIN_API_KEY` is a password chosen by you for the local admin page. It is not
  supplied by Paystack or Alchemy.
- Do not add quotes around values in `.env`.

The `rpc` detection mode above is the easiest first launch because it does not
need a public webhook. It polls both chains and therefore uses more RPC requests.
The lower-cost Alchemy webhook setup is explained below.

### 4. Start the gateway

Double-click `start-gateway.cmd` again. The first build downloads container
images and dependencies and can take several minutes. Later starts are faster.

When startup succeeds, use these addresses:

| Page | Address |
| --- | --- |
| Merchant dashboard | <http://localhost:5173> |
| Admin page | <http://localhost:5173/admin> |
| API health | <http://localhost:4000/api/system/health> |

The API health page should eventually show `"status":"ok"`, database `up` and
worker `up`. The dashboard may take one or two minutes to become available on a
first launch while images are built and the worker checks both networks.

### 5. Stop or restart it

- Double-click `stop-gateway.cmd` to stop everything without deleting data.
- Double-click `start-gateway.cmd` to start it again.
- Double-click `logs-gateway.cmd` to watch the API and worker logs. Press
  `Ctrl+C` to stop watching; this does not stop the gateway.

The database and Redis data live in Docker volumes and survive a normal stop,
Windows restart and Docker Desktop restart.

## Recommended Alchemy webhook mode

Webhook mode is recommended after the first RPC-mode launch works. It uses
Alchemy Address Activity notifications as the primary detector and keeps HTTPS
RPC calls only for confirmation depth, canonical-block checks and a bounded
startup recovery scan.

### What is required

- An Alchemy application with Polygon Mainnet and BNB Mainnet HTTPS RPC access.
- An Alchemy Notify authentication token.
- One Address Activity webhook for Polygon Mainnet.
- One Address Activity webhook for BNB Mainnet.
- A public HTTPS URL that forwards to local API port `4000`. For a local
  demonstration, ngrok can provide this URL.

### Setup

1. Start an ngrok tunnel in a separate Command Prompt or PowerShell window:

   ```powershell
   ngrok http 4000
   ```

2. Copy the public `https://...` address shown by ngrok.
3. In Alchemy Notify, create the two Address Activity webhooks. Use this endpoint
   for both, replacing the sample host:

   ```text
   https://your-ngrok-host.ngrok.app/api/webhooks/alchemy
   ```

4. Copy each webhook's ID and signing key. Also copy the Alchemy Notify API
   authentication token.
5. Stop the gateway, edit `.env`, and set:

   ```dotenv
   CHAIN_DETECTION_MODE=alchemy

   POLYGON_RPC_URL=https://your-polygon-https-rpc-url
   BSC_RPC_URL=https://your-bsc-https-rpc-url

   ALCHEMY_NOTIFY_AUTH_TOKEN=your-notify-auth-token
   ALCHEMY_POLYGON_WEBHOOK_ID=wh_your_polygon_webhook_id
   ALCHEMY_BSC_WEBHOOK_ID=wh_your_bsc_webhook_id
   ALCHEMY_POLYGON_SIGNING_KEY=your_polygon_signing_key
   ALCHEMY_BSC_SIGNING_KEY=your_bsc_signing_key
   ```

6. Run `start-gateway.cmd` again and keep ngrok running while receiving
   payments.

Each new invoice address is added to the correct Alchemy webhook automatically.
The worker also resynchronizes active invoice addresses at startup. If the ngrok
hostname changes, update both Alchemy webhook destination URLs before testing.

## Paystack and automatic payout

There is no merchant login or registration. A user enters a ten-digit Nigerian
bank account number and selects the bank. Paystack confirms the account holder,
and that bank account becomes the merchant identity used by the proof of concept.

Every confirmed payment proceeds automatically from quote creation to Paystack
transfer. There is no payout approval switch in this project. For live Paystack
transfers, configure the Paystack account so transfer OTP approval is disabled;
otherwise Paystack will hold the automated transfer for OTP completion.

Paystack transfer remarks use `TRF` and do not mention cryptocurrency, tokens or
USDT.

## Sweeping invoice wallets

Payment detection and naira payout do not automatically move the ERC-20 tokens
out of the invoice address. To use the admin page to fund gas and sweep confirmed
deposits into a treasury, add these values to `.env`:

```dotenv
TREASURY_ADDRESS=0xYourTreasuryWalletAddress
SWEEP_GAS_PRIVATE_KEY=0xPrivateKeyOfTheWalletThatFundsGas
```

The gas wallet needs native POL on Polygon and BNB on BSC. The treasury address
receives the swept tokens. The gas wallet private key and wallet mnemonic are
different secrets and both must remain private.

After editing `.env`, run:

```powershell
docker compose up -d --force-recreate api worker
```

Then open <http://localhost:5173/admin>, enter `ADMIN_API_KEY`, fund gas for an
eligible confirmed deposit and sweep it to the treasury.

## Useful Docker commands

Open PowerShell inside the project folder before running these commands.

```powershell
# Start or rebuild the complete core stack
docker compose up -d --build

# Show whether every container is running and healthy
docker compose ps

# Follow application logs
docker compose logs --follow --tail 150 api worker

# Restart only the application containers after changing .env
docker compose up -d --force-recreate api worker web

# Stop the project but keep all data
docker compose down

# Start optional Prometheus and Grafana monitoring
docker compose --profile observability up -d
```

Monitoring addresses:

- Prometheus: <http://localhost:9090>
- Grafana: <http://localhost:3000>
- Grafana user: `admin`
- Grafana password: the `GRAFANA_ADMIN_PASSWORD` value from `.env`

### Permanently erase local data

The following command deletes the project database, Redis stream data and
Grafana data. It cannot be undone:

```powershell
docker compose down --volumes
```

Do not use it merely to restart the project.

## Troubleshooting

### “Docker was not found” or “Docker Desktop is not running”

Open Docker Desktop and wait for the engine to finish starting. If Docker was
just installed, restart Windows once and try again.

### Port 4000 or 5173 is already in use

An older copy of the gateway or another program is using the port. Run:

```powershell
docker compose down
docker ps
```

Stop the old container shown by `docker ps`, or close the older non-Docker
gateway process, then start this project again.

### The worker is unhealthy or keeps restarting

Inspect its latest error:

```powershell
docker compose logs --tail 200 worker
```

The usual causes are a missing/incorrect HTTPS RPC URL, incomplete Alchemy
webhook settings, an invalid wallet mnemonic, or no internet connection.

### The bank list does not load or account resolution fails

Confirm that `PAYSTACK_SECRET_KEY` is present and begins with `sk_test_` or
`sk_live_`. Restart the API and worker after changing it. The form waits until a
complete ten-digit account and bank are selected, then sends one resolution
request.

### A transfer was sent but no payment appeared

Check all of the following:

- The token, network and destination address exactly match the invoice.
- The Alchemy webhooks point to the current ngrok HTTPS URL.
- The Polygon and BSC webhook IDs/signing keys were not swapped.
- ngrok, Docker Desktop, API and worker were running when the transfer arrived.
- The transaction is successful on the relevant block explorer.

The worker performs a bounded startup recovery scan, but the webhook setup
should still be corrected before sending another real transaction.

### View every service’s startup error

```powershell
docker compose logs --tail 300
```

## Final evaluation in Docker

The evaluation runner performs only a non-broadcasting preflight while
`EVAL_LIVE=false`. Configure the `EVAL_*`, merchant and treasury sender values in
`.env`, ensure the gateway is healthy, then run:

```powershell
docker compose --profile evaluation run --rm evaluation
```

Results are written to the Windows `evaluation-results` folder. Setting
`EVAL_LIVE=true` authorizes real ERC-20 transactions and real payout processing,
so use it only after reviewing `docs/FINAL-EVALUATION.md`.

## Container architecture

| Container | Purpose | Host port |
| --- | --- | --- |
| `web` | Nginx + compiled React dashboard | 5173 |
| `api` | Express API and Alchemy webhook receiver | 4000 |
| `worker` | Detection, confirmations, payouts, ledger and sweeping | internal only |
| `migrate` | Applies PostgreSQL migrations once, then exits | none |
| `postgres` | Durable gateway records and ledger | internal only |
| `redis` | Event stream, consumer groups and delivery retries | internal only |
| `prometheus` | Optional metrics collection | 9090 |
| `grafana` | Optional metrics interface | 3000 |

The `migrate` container showing `Exited (0)` is normal: zero means every
migration completed successfully. PostgreSQL and Redis are deliberately not
published to Windows host ports, which avoids conflicts with local installations
and prevents accidental outside access.

## Developers running without Docker

Docker is recommended on Windows. For native development, use Node.js 20 or 22,
pnpm 9, PostgreSQL 16 and Redis 7:

```text
pnpm install
copy .env.example .env
pnpm setup
pnpm dev
```

Run the automated checks with `pnpm test`, `pnpm typecheck` and `pnpm build`.

## Project layout

```text
packages/core        configuration, events, money and metrics
packages/db          PostgreSQL migrations and repositories
packages/broker      Redis Streams broker and dead-letter handling
packages/chain       network definitions, detection and wallet sweeping
packages/providers   Alchemy, FX, Paystack and webhook providers
apps/api             HTTP API and Alchemy webhook receiver
apps/worker          event consumers and background schedules
apps/web             React merchant and administration dashboard
apps/evaluation      guarded real-chain evaluation runner
```
