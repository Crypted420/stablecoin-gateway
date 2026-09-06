import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NETWORKS, TOKENS, type Network, type Token } from "@gateway/core";
import { z } from "zod";
import type { EvaluationConfig } from "./types.js";

function loadEnvironment(): void {
  if (process.env.VITEST) return;
  const candidate = resolve(process.cwd(), ".env");
  if (existsSync(candidate)) process.loadEnvFile(candidate);
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function basisPoints(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 10_000 || value > 20_000) {
    throw new Error(`${name} must be an integer between 10000 and 20000`);
  }
  return value;
}

function booleanValue(name: string): boolean {
  const value = process.env[name] ?? "false";
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function networkList(): Network[] {
  const values = (process.env.EVAL_NETWORKS ?? "polygon,bsc")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error("EVAL_NETWORKS must include at least one network");
  const parsed = values.map((value) => z.enum(NETWORKS).parse(value));
  return [...new Set(parsed)];
}

function firstProviderUrl(network: Network): string {
  const prefix = network.toUpperCase();
  const explicit = process.env[`${prefix}_RPC_URL`]?.trim();
  if (explicit) return explicit;
  const plural = process.env[`${prefix}_RPC_URLS`]
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  return plural || "";
}

function privateKey(network: Network): string {
  const prefix = network.toUpperCase();
  return (
    process.env[`${prefix}_TREASURY_PRIVATE_KEY`]?.trim() ||
    process.env.TREASURY_PRIVATE_KEY?.trim() ||
    ""
  );
}

function confirmationDepth(network: Network): number {
  return positiveInteger(`${network.toUpperCase()}_CONFIRMATIONS`, network === "polygon" ? 60 : 15);
}

export function evaluationConfig(): EvaluationConfig {
  loadEnvironment();
  const amount = process.env.EVAL_AMOUNT ?? "0.50";
  if (!/^\d+(\.\d{1,8})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error("EVAL_AMOUNT must be a positive decimal with no more than 8 decimal places");
  }
  const token = z.enum(TOKENS).parse(process.env.EVAL_TOKEN ?? "USDT") as Token;
  const networks = networkList();

  return {
    apiUrl: (process.env.EVAL_API_URL ?? "http://localhost:4000").replace(/\/$/, ""),
    networks,
    token,
    amount,
    measuredFlows: positiveInteger("EVAL_RUNS", 4),
    warmupFlows: nonNegativeInteger("EVAL_WARMUP_RUNS", 0),
    repeats: positiveInteger("EVAL_REPEATS", 1),
    concurrency: positiveInteger("EVAL_CONCURRENCY", 2),
    timeoutMs: positiveInteger("EVAL_TIMEOUT_MS", 600_000),
    pollIntervalMs: positiveInteger("EVAL_POLL_INTERVAL_MS", 1_000),
    targetReadyMs: nonNegativeInteger("EVAL_TARGET_READY_MS", 6_000),
    reconciliationDelayMs: nonNegativeInteger("EVAL_RECONCILIATION_DELAY_MS", 5_000),
    payoutBalanceBufferBps: basisPoints("EVAL_PAYOUT_BALANCE_BUFFER_BPS", 11_000),
    live: booleanValue("EVAL_LIVE"),
    adminApiKey: process.env.ADMIN_API_KEY?.trim() ?? "",
    paystackSecretKey: process.env.PAYSTACK_SECRET_KEY?.trim() ?? "",
    fxUrl: process.env.FX_URL?.trim() || "https://api.fiampayments.com/api/quote",
    merchantId: process.env.EVAL_MERCHANT_ID?.trim() ?? "",
    merchantAccountNumber: process.env.MERCHANT_ACCOUNT_NUMBER?.trim() ?? "",
    merchantBankCode: process.env.MERCHANT_BANK_CODE?.trim() ?? "",
    outputDirectory: resolve(process.cwd(), process.env.EVAL_OUTPUT_DIR ?? "evaluation-results"),
    rpcUrls: Object.fromEntries(networks.map((network) => [network, firstProviderUrl(network)])) as Record<
      Network,
      string
    >,
    privateKeys: Object.fromEntries(networks.map((network) => [network, privateKey(network)])) as Record<
      Network,
      string
    >,
    confirmationDepths: Object.fromEntries(
      networks.map((network) => [network, confirmationDepth(network)])
    ) as Record<Network, number>
  };
}
