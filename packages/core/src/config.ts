import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://gateway:gateway@localhost:5432/gateway"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  EVENT_BROKER: z.enum(["redis", "postgres"]).default("redis"),
  API_PORT: z.coerce.number().default(4000),
  ADMIN_API_KEY: z.string().default(""),
  ENFORCE_HTTPS: z.enum(["true", "false"]).default("false"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  WORKER_CONTROL_URL: z.string().default("http://localhost:4100"),
  WORKER_CONTROL_HOST: z.string().default("127.0.0.1"),

  WALLET_MNEMONIC: z.string().default(""),

  POLYGON_RPC_URL: z.string().default(""),
  BSC_RPC_URL: z.string().default(""),
  POLYGON_RPC_URLS: z.string().default(""),
  BSC_RPC_URLS: z.string().default(""),
  CHAIN_DETECTION_MODE: z.enum(["rpc", "alchemy"]).default("rpc"),
  POLYGON_CONFIRMATIONS: z.coerce.number().default(60),
  BSC_CONFIRMATIONS: z.coerce.number().default(15),
  CONFIRMATION_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  CHAIN_BACKFILL_BLOCKS: z.coerce.number().int().positive().default(200),
  CHAIN_TARGET_BACKFILL_BLOCKS: z.coerce.number().int().positive().default(20),
  CHAIN_SCAN_RANGE_BLOCKS: z.coerce.number().int().positive().default(10),
  CHAIN_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(15000),

  ALCHEMY_NOTIFY_AUTH_TOKEN: z.string().default(""),
  ALCHEMY_POLYGON_WEBHOOK_ID: z.string().default(""),
  ALCHEMY_BSC_WEBHOOK_ID: z.string().default(""),
  ALCHEMY_POLYGON_SIGNING_KEY: z.string().default(""),
  ALCHEMY_BSC_SIGNING_KEY: z.string().default(""),

  TREASURY_ADDRESS: z.string().default(""),
  SWEEP_GAS_PRIVATE_KEY: z.string().default(""),
  SWEEP_CONFIRMATIONS: z.coerce.number().int().positive().default(1),
  SWEEP_GAS_BUFFER_BPS: z.coerce.number().int().min(10000).max(30000).default(13000),
  SWEEP_MAX_BATCH: z.coerce.number().int().positive().max(100).default(50),

  FX_URL: z.string().default("https://api.fiampayments.com/api/quote"),
  FX_QUOTE_TTL_SECONDS: z.coerce.number().default(120),

  PAYOUT_STATUS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  PAYSTACK_SECRET_KEY: z.string().default(""),
  WEBHOOK_SIGNING_SECRET: z.string().default(""),

  INVOICE_TTL_MINUTES: z.coerce.number().default(30),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
  DLQ_MAX_ATTEMPTS: z.coerce.number().default(5)
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
let envLoaded = false;

function loadDotEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  if (process.env.VITEST) return;
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        return;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function config(): Config {
  if (!cached) {
    loadDotEnv();
    cached = schema.parse(process.env);
  }
  return cached;
}

export function resetConfig(): void {
  cached = null;
  envLoaded = false;
}

export function confirmationDepth(network: string): number {
  const c = config();
  return network === "polygon" ? c.POLYGON_CONFIRMATIONS : c.BSC_CONFIRMATIONS;
}

export function chainProviderUrls(network: string): string[] {
  const c = config();
  const plural =
    network === "polygon" ? c.POLYGON_RPC_URLS : c.BSC_RPC_URLS;
  const single = network === "polygon" ? c.POLYGON_RPC_URL : c.BSC_RPC_URL;
  const urls = plural
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (single.trim()) urls.push(single.trim());
  return [...new Set(urls)];
}

export function alchemyWebhookId(network: string): string {
  const c = config();
  return network === "polygon" ? c.ALCHEMY_POLYGON_WEBHOOK_ID : c.ALCHEMY_BSC_WEBHOOK_ID;
}

export function alchemySigningKey(network: string): string {
  const c = config();
  return network === "polygon" ? c.ALCHEMY_POLYGON_SIGNING_KEY : c.ALCHEMY_BSC_SIGNING_KEY;
}

export function assertChainDetectionConfigured(): void {
  const c = config();
  if (c.CHAIN_DETECTION_MODE !== "alchemy") return;
  const required = [
    "ALCHEMY_NOTIFY_AUTH_TOKEN",
    "ALCHEMY_POLYGON_WEBHOOK_ID",
    "ALCHEMY_BSC_WEBHOOK_ID",
    "ALCHEMY_POLYGON_SIGNING_KEY",
    "ALCHEMY_BSC_SIGNING_KEY"
  ] as const;
  const missing = required.filter((name) => !c[name].trim());
  if (missing.length > 0) {
    throw new Error(`Alchemy webhook detection is missing: ${missing.join(", ")}`);
  }
}
