import { afterEach, describe, expect, it } from "vitest";
import { resetConfig, type Network } from "@gateway/core";
import { narrowRange, rangeLimitFrom, widenRange } from "./live-source.js";
import { LiveChainSource } from "./live-source.js";

const freeTier = new Error(
  'could not coalesce error (error={ "code": -32600, "message": "Under the Free tier plan, you can ' +
    'make eth_getLogs requests with up to a 10 block range. Based on your parameters, this block ' +
    'range should work: [0x7255d9d, 0x7255da6]. Upgrade to PAYG for expanded block range." }, ' +
    "code=UNKNOWN_ERROR, version=6.13.4)"
);

afterEach(() => {
  delete process.env.CHAIN_TARGET_BACKFILL_BLOCKS;
  resetConfig();
});

describe("new payment targets", () => {
  it("rewinds the affected cursor so an immediate deposit is backfilled", () => {
    process.env.CHAIN_TARGET_BACKFILL_BLOCKS = "20";
    resetConfig();
    const source = new LiveChainSource(["bsc"]);
    const internals = source as unknown as { cursors: Map<Network, number> };
    internals.cursors.set("bsc", 1_000);

    source.setTargets([
      {
        address: "0x0000000000000000000000000000000000000001",
        network: "bsc",
        tokenSymbol: "USDT",
        invoiceId: "invoice-1"
      }
    ]);

    expect(internals.cursors.get("bsc")).toBe(980);
    source.setTargets([
      {
        address: "0x0000000000000000000000000000000000000001",
        network: "bsc",
        tokenSymbol: "USDT",
        invoiceId: "invoice-1"
      }
    ]);
    expect(internals.cursors.get("bsc")).toBe(980);
  });
});

describe("provider log-range limits", () => {
  it("reads the range the provider states it will accept", () => {
    expect(rangeLimitFrom(freeTier)).toBe(10);
    expect(
      rangeLimitFrom(new Error("You can make eth_getLogs requests with up to a 500 block range"))
    ).toBe(500);
  });

  it("recognises a limit that states no number", () => {
    expect(rangeLimitFrom(new Error("query returned more than 10000 results"))).toBeGreaterThan(0);
    expect(rangeLimitFrom(new Error("eth_getLogs is limited to 1000 blocks"))).toBeGreaterThan(0);
  });

  it("leaves unrelated failures alone so they still surface", () => {
    expect(rangeLimitFrom(new Error("connect ECONNREFUSED"))).toBeNull();
    expect(rangeLimitFrom(new Error("invalid api key"))).toBeNull();
  });

  it("narrows to the stated limit rather than merely halving", () => {
    expect(narrowRange(250, 10)).toBe(10);
  });

  it("halves when the provider states no number", () => {
    expect(narrowRange(250, Number.MAX_SAFE_INTEGER)).toBe(125);
  });

  it("stops narrowing at the floor so a real fault is not hidden", () => {
    expect(narrowRange(5, 10)).toBeNull();
    expect(narrowRange(250, null)).toBeNull();
  });

  it("converges on a ten-block provider from a wide default", () => {
    let range = 250;
    const steps: number[] = [];
    for (let i = 0; i < 10 && range > 10; i += 1) {
      const next = narrowRange(range, 10);
      if (next === null) break;
      range = next;
      steps.push(range);
    }
    expect(steps).toEqual([10]);
    expect(range).toBe(10);
  });

  it("widens back towards the configured maximum once the provider accepts again", () => {
    expect(widenRange(10, 250)).toBe(13);
    expect(widenRange(200, 250)).toBe(250);
    expect(widenRange(250, 250)).toBe(250);
  });
});
