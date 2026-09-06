# Real-chain final evaluation

The evaluation runner creates normal gateway invoices and sends real ERC-20 transfers to their derived deposit addresses on Polygon and BNB Smart Chain. It does not insert simulated payments or modify pipeline state directly.

By default the command performs preflight only. It checks API and worker health, advertised assets, the verified payout account, the canonical FX quote, Paystack's available NGN balance, RPC chain IDs, on-chain token decimals, sender token balances and estimated native gas. It creates no invoices and broadcasts no transactions until `EVAL_LIVE=true` is explicitly set.

For the low-request production path, run the gateway with `CHAIN_DETECTION_MODE=alchemy`. Create separate Polygon Mainnet and BNB Mainnet Address Activity webhooks whose destination is `https://<your-ngrok-host>/api/webhooks/alchemy`, then configure the Notify API token, both webhook IDs and both signing keys. Invoice creation fails closed if its address cannot be registered, so a measured transfer cannot race ahead of webhook tracking. RPC URLs remain necessary for confirmation and reorg checks.

## Funding

Fund one EVM address on both networks with:

- The selected token, such as USDT.
- POL on Polygon for transaction fees.
- BNB on BNB Smart Chain for transaction fees.

Set `TREASURY_PRIVATE_KEY` to that address's private key. The runner also accepts `POLYGON_TREASURY_PRIVATE_KEY` and `BSC_TREASURY_PRIVATE_KEY` when separate senders are required. Never commit these values.

If the gateway's `TREASURY_ADDRESS` is the same sender address, sweeping returns evaluated deposits to the original treasury. The sweep gas wallet still needs enough POL and BNB to fund the derived deposit wallets before sweeping.

## Configuration

```dotenv
EVAL_API_URL=http://localhost:4000
EVAL_NETWORKS=polygon,bsc
EVAL_TOKEN=USDT
EVAL_AMOUNT=0.50
EVAL_RUNS=4
EVAL_WARMUP_RUNS=2
EVAL_REPEATS=3
EVAL_CONCURRENCY=2
EVAL_TIMEOUT_MS=600000
EVAL_POLL_INTERVAL_MS=1000
EVAL_TARGET_READY_MS=6000
EVAL_RECONCILIATION_DELAY_MS=5000
EVAL_PAYOUT_BALANCE_BUFFER_BPS=11000
EVAL_LIVE=false
EVAL_OUTPUT_DIR=evaluation-results

TREASURY_PRIVATE_KEY=
POLYGON_RPC_URL=
BSC_RPC_URL=

# Gateway process configuration when using Alchemy detection.
CHAIN_DETECTION_MODE=alchemy
ALCHEMY_NOTIFY_AUTH_TOKEN=
ALCHEMY_POLYGON_WEBHOOK_ID=
ALCHEMY_BSC_WEBHOOK_ID=
ALCHEMY_POLYGON_SIGNING_KEY=
ALCHEMY_BSC_SIGNING_KEY=

# Use an existing merchant, or provide the account fields below.
EVAL_MERCHANT_ID=
MERCHANT_ACCOUNT_NUMBER=
MERCHANT_BANK_CODE=
```

Payouts are submitted to Paystack automatically after confirmation and quote locking. Preflight requires `PAYSTACK_SECRET_KEY`, checks the NGN balance using Paystack's balance endpoint, and reserves the configured buffer above estimated payout principal for fees. `ADMIN_API_KEY` is still used by the evaluation runner to request the final reconciliation report. Use a Paystack test key unless the evaluation explicitly requires spending real naira.

## Run sequence

Start PostgreSQL, Redis, the API, worker and web application first. Then run the safe preflight:

```bash
pnpm evaluate
```

For the initial paired proof, keep `EVAL_RUNS=4`, `EVAL_CONCURRENCY=2`, `EVAL_WARMUP_RUNS=2`, and set `EVAL_LIVE=true`. This creates one discarded warm-up per network followed by four measured flows, with Polygon and BSC transfers submitted concurrently. Set `EVAL_REPEATS=3` to run the same configuration three times; the warm-up runs once before the repeated measured configurations, and repeat outputs are grouped under one timestamped batch directory.

Only after the repeated baseline succeeds should the NFR-02 load be attempted. Run its preflight first, then explicitly enable live mode:

```bash
EVAL_RUNS=50 EVAL_CONCURRENCY=50 EVAL_WARMUP_RUNS=2 EVAL_REPEATS=1 EVAL_LIVE=false pnpm evaluate
EVAL_RUNS=50 EVAL_CONCURRENCY=50 EVAL_WARMUP_RUNS=2 EVAL_REPEATS=1 EVAL_LIVE=true pnpm evaluate
```

Confirm token, payout and gas costs before the live command. NFR-02 is decided from achieved overlapping flow intervals, not merely the configured concurrency value.

## Failure injection

Run the deterministic service-level fault suite without spending tokens or contacting Paystack:

```bash
pnpm evaluate:failures
```

It writes raw and summarized JSON evidence for an unacknowledged consumer termination, a replayed transfer event, a non-canonical/reorged payment and an ambiguous payout timeout recovered by idempotent lookup.

## Evidence produced

Each timestamped directory under `evaluation-results` contains:

- `preflight.json`: chain IDs, sender addresses, balances, raw transfer amounts and workload.
- `flows.json`: every raw flow and calculated pipeline duration.
- `flows.csv`: rows ready for the Chapter Five tables.
- `summary.json`: median and p95 total/post-finality latency, throughput, success rate, missed transfers, duplicate provider references, non-terminal flows and NFR results.

Warm-up flows run to terminal state before the measured phase begins. They remain in the raw evidence but are excluded from summary calculations. Total latency is measured from transfer submission through completed payout. Post-finality latency is reported separately and does not replace the total metric.
