import { afterEach, describe, expect, it } from "vitest";
import { assertChainDetectionConfigured, chainProviderUrls, resetConfig } from "./config.js";

const ALCHEMY_FIELDS = [
  "ALCHEMY_NOTIFY_AUTH_TOKEN",
  "ALCHEMY_POLYGON_WEBHOOK_ID",
  "ALCHEMY_BSC_WEBHOOK_ID",
  "ALCHEMY_POLYGON_SIGNING_KEY",
  "ALCHEMY_BSC_SIGNING_KEY"
] as const;
const RPC_FIELDS = [
  "POLYGON_RPC_URL",
  "BSC_RPC_URL",
  "POLYGON_RPC_URLS",
  "BSC_RPC_URLS"
] as const;

afterEach(() => {
  delete process.env.CHAIN_DETECTION_MODE;
  for (const field of ALCHEMY_FIELDS) delete process.env[field];
  for (const field of RPC_FIELDS) delete process.env[field];
  resetConfig();
});

describe("chain detection configuration", () => {
  it("does not require Alchemy Notify credentials in RPC mode", () => {
    process.env.CHAIN_DETECTION_MODE = "rpc";
    resetConfig();
    expect(() => assertChainDetectionConfigured()).not.toThrow();
  });

  it("fails startup rather than running deaf when Alchemy fields are missing", () => {
    process.env.CHAIN_DETECTION_MODE = "alchemy";
    resetConfig();
    expect(() => assertChainDetectionConfigured()).toThrow(/ALCHEMY_NOTIFY_AUTH_TOKEN/);
  });

  it("accepts a complete two-network Alchemy configuration", () => {
    process.env.CHAIN_DETECTION_MODE = "alchemy";
    for (const field of ALCHEMY_FIELDS) process.env[field] = `${field.toLowerCase()}-value`;
    resetConfig();
    expect(() => assertChainDetectionConfigured()).not.toThrow();
  });

  it("uses HTTPS RPC URLs without requiring a WebSocket endpoint", () => {
    process.env.POLYGON_RPC_URL = "https://polygon.example/rpc";
    process.env.BSC_RPC_URLS = "https://bsc-one.example/rpc, https://bsc-two.example/rpc";
    resetConfig();
    expect(chainProviderUrls("polygon")).toEqual(["https://polygon.example/rpc"]);
    expect(chainProviderUrls("bsc")).toEqual([
      "https://bsc-one.example/rpc",
      "https://bsc-two.example/rpc"
    ]);
  });
});
