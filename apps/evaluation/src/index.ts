import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import axios, { type AxiosInstance } from "axios";
import {
  Contract,
  formatEther,
  formatUnits,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  parseUnits,
  type Provider,
  type TransactionReceipt
} from "ethers";
import { NETWORK_SPECS, tokenAddress } from "@gateway/chain";
import { tokenDecimals, type Invoice, type Merchant, type Network } from "@gateway/core";
import { evaluationConfig } from "./config.js";
import { writeOutputs } from "./output.js";
import type { EvaluationConfig, FlowRecord, InvoiceDetail } from "./types.js";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

interface NetworkRuntime {
  network: Network;
  provider: Provider;
  signer: NonceManager;
  senderAddress: string;
  token: Contract;
  tokenAddress: string;
  decimals: number;
  amountRaw: bigint;
  initialTokenBalance: bigint;
  initialNativeBalance: bigint;
  transfers: number;
  gasSpentRaw: bigint;
}

interface QuotePreflight {
  rate: string;
  latencyMs: number;
  source: "par" | "fiam";
}

interface PayoutPreflight {
  mode: "test" | "live" | "unknown";
  availableBalanceKobo: string;
  estimatedPrincipalKobo: string;
  requiredWithBufferKobo: string;
  bufferBps: number;
}

interface PreflightResult {
  runtimes: Map<Network, NetworkRuntime>;
  merchant: Merchant;
  quote: QuotePreflight;
  payout: PayoutPreflight;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function retryTransient<T>(
  label: string,
  operation: () => Promise<T>,
  attempts = 2,
  timeoutMs = 10_000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
    } catch (error) {
      lastError = error;
      const transient = /ECONNRESET|ETIMEDOUT|timeout|socket hang up|network error|\b429\b|\b50[234]\b/i.test(
        errorMessage(error)
      );
      if (!transient || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error(`${label}: ${errorMessage(lastError)}`);
}

function providerFor(url: string, network: Network): Provider {
  const chainId = NETWORK_SPECS[network].chainId;
  if (/^https?:/i.test(url)) return new JsonRpcProvider(url, chainId, { staticNetwork: true });
  throw new Error(`${network} RPC URL must start with http:// or https://`);
}

function blankFlow(
  index: number,
  network: Network,
  config: EvaluationConfig,
  warmupFlows: number
): FlowRecord {
  const warmup = index < warmupFlows;
  const sequence = String(index + 1).padStart(3, "0");
  return {
    flowId: `${warmup ? "warmup" : "measured"}-${sequence}-${network}`,
    warmup,
    network,
    token: config.token,
    amount: config.amount,
    invoiceId: null,
    reference: `EVAL-${Date.now()}-${sequence}-${network.toUpperCase()}`,
    depositAddress: null,
    senderAddress: null,
    txHash: null,
    paymentId: null,
    paymentAmountRaw: null,
    confirmations: null,
    settlementId: null,
    providerReference: null,
    providerStatus: null,
    quoteRate: null,
    amountNgn: null,
    invoiceStatus: null,
    paymentStatus: null,
    settlementStatus: null,
    invoiceCreatedAt: null,
    transferSubmittedAt: null,
    transferBroadcastAt: null,
    blockMinedAt: null,
    receiptObservedAt: null,
    paymentDetectedAt: null,
    paymentConfirmedAt: null,
    quoteLockedAt: null,
    payoutSubmittedAt: null,
    completedAt: null,
    gasUsedRaw: null,
    gasCostNativeRaw: null,
    error: null
  };
}

async function preflight(
  config: EvaluationConfig,
  api: AxiosInstance,
  remainingTransfers: Record<Network, number>
): Promise<PreflightResult> {
  console.log("[preflight] checking API and worker health");
  const health = await api.get("/api/system/health", { validateStatus: () => true });
  if (health.status !== 200 || health.data?.status !== "ok") {
    const detail = health.data && typeof health.data === "object" ? JSON.stringify(health.data) : String(health.data);
    throw new Error(`Gateway is not healthy: HTTP ${health.status} ${detail}`);
  }
  console.log("[preflight] checking advertised assets");
  const assets = await api.get("/api/system/assets");
  for (const network of config.networks) {
    const supported = assets.data?.assets?.some(
      (asset: { network?: string; tokenSymbol?: string }) =>
        asset.network === network && asset.tokenSymbol === config.token
    );
    if (!supported) throw new Error(`${config.token} on ${network} is not advertised by the gateway`);
  }

  const runtimes = new Map<Network, NetworkRuntime>();
  for (const network of config.networks) {
    console.log(`[preflight] checking ${network} RPC, contract, token balance and gas`);
    const url = config.rpcUrls[network];
    const privateKey = config.privateKeys[network];
    if (!url) throw new Error(`No ${network} RPC URL is configured`);
    if (!privateKey) throw new Error(`No treasury private key is configured for ${network}`);
    const provider = providerFor(url, network);
    try {
      const networkInfo = await retryTransient(`${network} chain identity check failed`, () =>
        provider.getNetwork()
      );
      if (Number(networkInfo.chainId) !== NETWORK_SPECS[network].chainId) {
        throw new Error(`${network} RPC returned chain id ${networkInfo.chainId}`);
      }
      const signer = new NonceManager(new Wallet(privateKey, provider));
      const senderAddress = await signer.getAddress();
      const address = tokenAddress(network, config.token);
      if (!address) throw new Error(`${config.token} has no configured ${network} contract`);
      const token = new Contract(address, ERC20_ABI, signer);
      const actualDecimals = Number(
        await retryTransient(`${network} ${config.token} decimals check failed`, () => token["decimals"]!())
      );
      const assumedDecimals = tokenDecimals(network, config.token);
      if (actualDecimals !== assumedDecimals) {
        const factor = 10n ** BigInt(Math.abs(actualDecimals - assumedDecimals));
        throw new Error(
          `${network} ${config.token} decimals mismatch: contract=${actualDecimals}, gateway=${assumedDecimals}; ` +
            `amounts would be wrong by ${factor.toString()}x`
        );
      }
      const amountRaw = parseUnits(config.amount, actualDecimals);
      const transfers = remainingTransfers[network];
      const [initialTokenBalance, initialNativeBalance] = await retryTransient(
        `${network} treasury balance check failed`,
        () =>
          Promise.all([
            token["balanceOf"]!(senderAddress) as Promise<bigint>,
            provider.getBalance(senderAddress)
          ])
      );
      const requiredTokens = amountRaw * BigInt(transfers);
      if (initialTokenBalance < requiredTokens) {
        throw new Error(
          `${network} ${config.token} balance is too low: need ${requiredTokens}, have ${initialTokenBalance} raw units`
        );
      }
      const estimatedGas = (await retryTransient(`${network} gas estimation failed`, () =>
        token["transfer"]!.estimateGas(senderAddress, amountRaw)
      )) as bigint;
      const fee = await retryTransient(`${network} fee-data check failed`, () => provider.getFeeData());
      const feePerGas = fee.maxFeePerGas ?? fee.gasPrice;
      if (feePerGas) {
        const requiredNative = (estimatedGas * feePerGas * BigInt(transfers) * 13n) / 10n;
        if (initialNativeBalance < requiredNative) {
          throw new Error(
            `${network} native gas balance is too low: estimated need ${requiredNative}, have ${initialNativeBalance} wei`
          );
        }
      }
      runtimes.set(network, {
        network,
        provider,
        signer,
        senderAddress,
        token,
        tokenAddress: address,
        decimals: actualDecimals,
        amountRaw,
        initialTokenBalance,
        initialNativeBalance,
        transfers,
        gasSpentRaw: 0n
      });
    } catch (error) {
      const destroyable = provider as Provider & { destroy?: () => void | Promise<void> };
      await destroyable.destroy?.();
      throw error;
    }
  }

  console.log("[preflight] checking verified payout merchant");
  const merchant = await merchantFor(config, api);
  if (merchant.status !== "active") throw new Error(`Evaluation merchant ${merchant.id} is not active`);
  if (!merchant.accountVerified) throw new Error(`Evaluation merchant ${merchant.id} has no verified bank account`);

  console.log("[preflight] checking canonical FX quote");
  const quote = await quoteForPreflight(config);
  console.log("[preflight] checking Paystack NGN balance");
  const payout = await payoutForPreflight(
    config,
    quote.rate,
    Object.values(remainingTransfers).reduce((total, count) => total + count, 0)
  );
  return { runtimes, merchant, quote, payout };
}

async function quoteForPreflight(config: EvaluationConfig): Promise<QuotePreflight> {
  if (config.token === "cNGN") return { rate: "1.00000000", latencyMs: 0, source: "par" };
  const started = Date.now();
  const response = await retryTransient("Canonical FX quote request failed", () =>
    axios.get<{ rate?: string | number }>(config.fxUrl, {
      params: { token: config.token, network: "ethereum", cryptoAmount: "1" },
      timeout: 10_000,
      validateStatus: () => true
    })
  );
  const rate = Number(response.data?.rate);
  if (response.status >= 400 || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Canonical FX quote preflight failed with HTTP ${response.status}`);
  }
  return { rate: rate.toFixed(8), latencyMs: Date.now() - started, source: "fiam" };
}

function estimatedPrincipalKobo(amount: string, rate: string, transfers: number): bigint {
  const amountScale = parseUnits(amount, 8);
  const rateScale = parseUnits(rate, 8);
  const divisor = 10n ** 14n;
  const perTransfer = (amountScale * rateScale + divisor / 2n) / divisor;
  return perTransfer * BigInt(transfers);
}

async function payoutForPreflight(
  config: EvaluationConfig,
  rate: string,
  transfers: number
): Promise<PayoutPreflight> {
  if (!config.paystackSecretKey) throw new Error("PAYSTACK_SECRET_KEY is required for payout preflight");
  const response = await retryTransient("Paystack balance request failed", () =>
    axios.get<{
      status?: boolean;
      message?: string;
      data?: Array<{ currency?: string; balance?: number | string }>;
    }>("https://api.paystack.co/balance", {
      headers: { Authorization: `Bearer ${config.paystackSecretKey}` },
      timeout: 10_000,
      validateStatus: () => true
    })
  );
  const ngnBalance = response.data?.data?.find((item) => item.currency === "NGN")?.balance;
  if (response.status >= 400 || !response.data?.status || ngnBalance === undefined) {
    throw new Error(response.data?.message || `Paystack balance preflight failed with HTTP ${response.status}`);
  }
  const available = BigInt(ngnBalance);
  const principal = estimatedPrincipalKobo(config.amount, rate, transfers);
  const required = (principal * BigInt(config.payoutBalanceBufferBps) + 9_999n) / 10_000n;
  if (available < required) {
    throw new Error(
      `Paystack NGN balance is too low: need about ${formatUnits(required, 2)} NGN including buffer, ` +
        `have ${formatUnits(available, 2)} NGN`
    );
  }
  return {
    mode: config.paystackSecretKey.startsWith("sk_test_")
      ? "test"
      : config.paystackSecretKey.startsWith("sk_live_")
        ? "live"
        : "unknown",
    availableBalanceKobo: available.toString(),
    estimatedPrincipalKobo: principal.toString(),
    requiredWithBufferKobo: required.toString(),
    bufferBps: config.payoutBalanceBufferBps
  };
}

async function merchantFor(config: EvaluationConfig, api: AxiosInstance): Promise<Merchant> {
  if (config.merchantId) {
    const response = await api.get(`/api/merchants/${config.merchantId}`, { validateStatus: () => true });
    if (response.status >= 400 || !response.data?.merchant) {
      throw new Error(
        response.data?.message || `Evaluation merchant lookup failed with HTTP ${response.status}`
      );
    }
    return response.data.merchant as Merchant;
  }
  if (!config.merchantAccountNumber || !config.merchantBankCode) {
    throw new Error(
      "Set EVAL_MERCHANT_ID, or set MERCHANT_ACCOUNT_NUMBER and MERCHANT_BANK_CODE so the merchant can be resolved"
    );
  }
  const response = await api.post(
    "/api/merchants/resolve",
    {
      bankAccountNumber: config.merchantAccountNumber,
      bankCode: config.merchantBankCode
    },
    { validateStatus: () => true }
  );
  if (response.status >= 400 || !response.data?.merchant) {
    throw new Error(response.data?.message || `Merchant resolution failed with HTTP ${response.status}`);
  }
  return response.data.merchant as Merchant;
}

async function createInvoice(flow: FlowRecord, merchantId: string, api: AxiosInstance): Promise<void> {
  const response = await api.post(`/api/merchants/${merchantId}/invoices`, {
    reference: flow.reference,
    amountExpected: flow.amount,
    tokenSymbol: flow.token,
    network: flow.network
  });
  const invoice = response.data.invoice as Invoice;
  flow.invoiceId = invoice.id;
  flow.depositAddress = invoice.depositAddress;
  flow.invoiceCreatedAt = invoice.createdAt;
  flow.invoiceStatus = invoice.status;
}

async function submitTransfer(flow: FlowRecord, runtime: NetworkRuntime): Promise<TransactionReceipt> {
  if (!flow.depositAddress) throw new Error(`${flow.flowId} has no deposit address`);
  flow.senderAddress = runtime.senderAddress;
  flow.transferSubmittedAt = new Date().toISOString();
  const transaction = await runtime.token["transfer"]!(flow.depositAddress, runtime.amountRaw);
  flow.txHash = transaction.hash;
  flow.transferBroadcastAt = new Date().toISOString();
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${flow.network} transfer ${transaction.hash} reverted`);
  flow.receiptObservedAt = new Date().toISOString();
  const block = await runtime.provider.getBlock(receipt.blockNumber);
  flow.blockMinedAt = block ? new Date(block.timestamp * 1_000).toISOString() : null;
  flow.gasUsedRaw = receipt.gasUsed.toString();
  flow.gasCostNativeRaw = receipt.fee.toString();
  runtime.gasSpentRaw += receipt.fee;
  return receipt;
}

function updateFlow(flow: FlowRecord, detail: InvoiceDetail): void {
  flow.invoiceStatus = detail.invoice.status;
  if (detail.payment) {
    flow.paymentId = detail.payment.id;
    flow.paymentAmountRaw = detail.payment.amountRaw;
    flow.confirmations = detail.payment.confirmations;
    flow.paymentStatus = detail.payment.status;
    flow.paymentDetectedAt = detail.payment.detectedAt;
    flow.paymentConfirmedAt = detail.payment.confirmedAt;
  }
  if (detail.settlement) {
    flow.settlementId = detail.settlement.id;
    flow.settlementStatus = detail.settlement.status;
    flow.providerReference = detail.settlement.providerReference;
    flow.providerStatus = detail.settlement.providerStatus;
    flow.quoteRate = detail.settlement.quoteRate;
    flow.amountNgn = detail.settlement.amountNgn;
    flow.quoteLockedAt = detail.settlement.quoteLockedAt;
    flow.payoutSubmittedAt = detail.settlement.submittedAt;
    flow.completedAt = detail.settlement.completedAt;
  }
}

async function waitForTerminal(
  flow: FlowRecord,
  merchantId: string,
  config: EvaluationConfig,
  api: AxiosInstance
): Promise<void> {
  if (!flow.invoiceId) throw new Error(`${flow.flowId} has no invoice id`);
  const deadline = Date.now() + config.timeoutMs;
  while (Date.now() < deadline) {
    const response = await api.get(`/api/merchants/${merchantId}/invoices/${flow.invoiceId}`);
    const detail = response.data as InvoiceDetail;
    updateFlow(flow, detail);

    if (["completed", "failed", "rejected", "dead_lettered"].includes(detail.settlement?.status ?? "")) {
      return;
    }
    if (["underpaid", "overpaid", "orphaned"].includes(detail.payment?.status ?? "")) return;
    if (detail.invoice.status === "expired") return;
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
  throw new Error(`${flow.flowId} did not reach a terminal state within ${config.timeoutMs}ms`);
}

async function inParallel<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await task(item);
    }
  });
  await Promise.all(workers);
}

async function closeProviders(runtimes: Map<Network, NetworkRuntime>): Promise<void> {
  for (const runtime of runtimes.values()) {
    const provider = runtime.provider as Provider & { destroy?: () => void | Promise<void> };
    await provider.destroy?.();
  }
}

async function runPhase(
  phase: "warmup" | "measured",
  flows: FlowRecord[],
  merchantId: string,
  config: EvaluationConfig,
  api: AxiosInstance,
  runtimes: Map<Network, NetworkRuntime>,
  checkpoint: () => Promise<void>
): Promise<void> {
  if (flows.length === 0) return;
  console.log(`Starting ${phase} phase with ${flows.length} flow(s)`);
  await inParallel(flows, Math.min(config.concurrency, 20), (flow) => createInvoice(flow, merchantId, api));
  if (config.targetReadyMs > 0) await new Promise((resolve) => setTimeout(resolve, config.targetReadyMs));
  await inParallel(flows, config.concurrency, async (flow) => {
    try {
      const runtime = runtimes.get(flow.network);
      if (!runtime) throw new Error(`No ${flow.network} runtime exists`);
      await submitTransfer(flow, runtime);
      await waitForTerminal(flow, merchantId, config, api);
    } catch (error) {
      flow.error = error instanceof Error ? error.message : String(error);
    } finally {
      await checkpoint();
      console.log(
        `${flow.flowId}: tx=${flow.txHash ?? "not-broadcast"} payment=${flow.paymentStatus ?? "none"} ` +
          `settlement=${flow.settlementStatus ?? "none"}${flow.error ? ` error=${flow.error}` : ""}`
      );
    }
  });
}

function warmupCount(config: EvaluationConfig, repeatIndex: number): number {
  return repeatIndex === 1 ? config.warmupFlows : 0;
}

function remainingTransferCounts(config: EvaluationConfig, repeatIndex: number): Record<Network, number> {
  const counts = Object.fromEntries(config.networks.map((network) => [network, 0])) as Record<Network, number>;
  for (let repeat = repeatIndex; repeat <= config.repeats; repeat += 1) {
    const total = config.measuredFlows + warmupCount(config, repeat);
    for (let index = 0; index < total; index += 1) {
      const network = config.networks[index % config.networks.length]!;
      counts[network] += 1;
    }
  }
  return counts;
}

async function runOnce(config: EvaluationConfig, batchId: string, repeatIndex: number): Promise<string> {
  const api = axios.create({ baseURL: config.apiUrl, timeout: 15_000, validateStatus: (status) => status < 400 });
  const repeatWarmupFlows = warmupCount(config, repeatIndex);
  const total = repeatWarmupFlows + config.measuredFlows;
  const flows = Array.from({ length: total }, (_, index) =>
    blankFlow(index, config.networks[index % config.networks.length]!, config, repeatWarmupFlows)
  );
  const runId = config.repeats > 1 ? `${batchId}-repeat-${String(repeatIndex).padStart(2, "0")}` : batchId;
  const runDirectory =
    config.repeats > 1
      ? join(config.outputDirectory, batchId, `repeat-${String(repeatIndex).padStart(2, "0")}`)
      : join(config.outputDirectory, batchId);
  const metadata = {
    runId,
    batchId,
    repeatIndex,
    repeats: config.repeats,
    startedAt: new Date().toISOString(),
    mode: config.live ? "live" : "preflight",
    networks: config.networks,
    token: config.token,
    amount: config.amount,
    measuredFlows: config.measuredFlows,
    warmupFlows: repeatWarmupFlows,
    configuredWarmupFlows: config.warmupFlows,
    concurrency: config.concurrency,
    timeoutMs: config.timeoutMs,
    targetReadyMs: config.targetReadyMs,
    reconciliationDelayMs: config.reconciliationDelayMs,
    payoutMode: "automatic",
    confirmationDepths: config.confirmationDepths,
    nodeVersion: process.version
  };

  await mkdir(runDirectory, { recursive: true });
  let runtimes = new Map<Network, NetworkRuntime>();
  let merchant: Merchant | null = null;
  try {
    try {
      const result = await preflight(config, api, remainingTransferCounts(config, repeatIndex));
      runtimes = result.runtimes;
      merchant = result.merchant;
      const preflightReport = {
        ...metadata,
        passed: true,
        merchant: {
          id: merchant.id,
          accountName: merchant.accountName,
          bankName: merchant.bankName,
          bankAccountLast4: merchant.bankAccountNumber.slice(-4),
          accountVerified: merchant.accountVerified,
          status: merchant.status
        },
        quote: result.quote,
        payout: {
          ...result.payout,
          availableBalanceNgn: formatUnits(result.payout.availableBalanceKobo, 2),
          estimatedPrincipalNgn: formatUnits(result.payout.estimatedPrincipalKobo, 2),
          requiredWithBufferNgn: formatUnits(result.payout.requiredWithBufferKobo, 2)
        },
        networks: [...runtimes.values()].map((runtime) => ({
          network: runtime.network,
          senderAddress: runtime.senderAddress,
          chainId: NETWORK_SPECS[runtime.network].chainId,
          tokenAddress: runtime.tokenAddress,
          decimals: runtime.decimals,
          confirmationDepth: config.confirmationDepths[runtime.network],
          transfers: runtime.transfers,
          tokenBalanceRaw: runtime.initialTokenBalance.toString(),
          tokenBalance: formatUnits(runtime.initialTokenBalance, runtime.decimals),
          nativeBalanceRaw: runtime.initialNativeBalance.toString(),
          nativeBalance: formatEther(runtime.initialNativeBalance),
          amountPerTransferRaw: runtime.amountRaw.toString()
        }))
      };
      await writeFile(join(runDirectory, "preflight.json"), JSON.stringify(preflightReport, null, 2));
      console.log(JSON.stringify(preflightReport, null, 2));
    } catch (error) {
      await writeFile(
        join(runDirectory, "preflight.json"),
        JSON.stringify(
          {
            ...metadata,
            passed: false,
            error: error instanceof Error ? error.message : String(error)
          },
          null,
          2
        )
      );
      throw error;
    }

    if (!config.live) {
      console.log("Preflight passed. No invoices were created and no transactions were broadcast.");
      console.log("Set EVAL_LIVE=true only when you are ready to spend the configured tokens and gas.");
      return runDirectory;
    }

    let checkpoint = Promise.resolve();
    const writeCheckpoint = async () => {
      checkpoint = checkpoint.then(() => writeOutputs(runDirectory, metadata, flows));
      await checkpoint;
    };
    const warmups = flows.filter((flow) => flow.warmup);
    const measured = flows.filter((flow) => !flow.warmup);
    await runPhase("warmup", warmups, merchant!.id, config, api, runtimes, writeCheckpoint);
    await runPhase("measured", measured, merchant!.id, config, api, runtimes, writeCheckpoint);

    let reconciliation: unknown = null;
    if (config.adminApiKey) {
      if (config.reconciliationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.reconciliationDelayMs));
      }
      const periodEnd = new Date().toISOString();
      reconciliation = await api
        .post(
          "/api/admin/reconciliation/run",
          { periodStart: metadata.startedAt, periodEnd },
          {
            headers: { Authorization: `Bearer ${config.adminApiKey}` }
          }
        )
        .then((response) => response.data)
        .catch(() => null);
    }
    await writeOutputs(runDirectory, { ...metadata, completedAt: new Date().toISOString() }, flows, reconciliation);
    console.log(`Evaluation results written to ${runDirectory}`);
    if (flows.some((flow) => flow.error)) process.exitCode = 1;
    return runDirectory;
  } finally {
    await closeProviders(runtimes);
  }
}

async function main(): Promise<void> {
  const config = evaluationConfig();
  const batchId = new Date().toISOString().replace(/[:.]/g, "-");
  const completedDirectories: string[] = [];
  const runsToExecute = config.live ? config.repeats : 1;

  for (let repeatIndex = 1; repeatIndex <= runsToExecute; repeatIndex += 1) {
    console.log(`Evaluation repeat ${repeatIndex}/${config.repeats}`);
    completedDirectories.push(await runOnce(config, batchId, repeatIndex));
    if (process.exitCode) break;
  }

  if (config.repeats > 1) {
    const batchDirectory = join(config.outputDirectory, batchId);
    await mkdir(batchDirectory, { recursive: true });
    await writeFile(
      join(batchDirectory, "batch.json"),
      JSON.stringify(
        {
          batchId,
          mode: config.live ? "live" : "preflight",
          requestedRepeats: config.repeats,
          completedRepeats: completedDirectories.length,
          repeatDirectories: completedDirectories
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
