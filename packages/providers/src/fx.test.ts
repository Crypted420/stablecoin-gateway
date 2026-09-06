import { describe, expect, it } from "vitest";
import { httpClient } from "./http.js";
import { CachingFxProvider, LiveFxProvider } from "./fx.js";

describe("Fiam Payments quote provider", () => {
  it.each(["polygon", "bsc"] as const)(
    "values cNGN at naira par on %s without calling Fiam",
    async (network) => {
      let calls = 0;
      const http = httpClient({
        adapter: async (config) => {
          calls += 1;
          throw new Error(`Unexpected HTTP request to ${config.url}`);
        }
      });

      const quote = await new LiveFxProvider("https://api.fiampayments.com/api/quote", http).quote(
        "cNGN",
        network,
        "250"
      );

      expect(quote.rate).toBe("1.00000000");
      expect(quote.fiatAmount).toBeUndefined();
      expect(calls).toBe(0);
    }
  );

  it("requests the canonical one-token rate and uses the returned quote", async () => {
    let seenParams: unknown;
    const http = httpClient({
      adapter: async (config) => {
        seenParams = config.params;
        return {
          status: 200,
          statusText: "",
          headers: {},
          config,
          data: {
            token: "USDT",
            network: "bsc",
            currency: "NGN",
            cryptoAmount: "0.100000",
            fiatAmount: "135.63",
            rate: 1356.3,
            expiresInSeconds: 30
          }
        };
      }
    });

    const quote = await new LiveFxProvider("https://api.fiampayments.com/api/quote", http).quote(
      "USDT",
      "bsc",
      "0.100000000000000000"
    );

    expect(seenParams).toEqual({
      token: "USDT",
      network: "ethereum",
      cryptoAmount: "1"
    });
    expect(quote.rate).toBe("1356.30000000");
    expect(quote.fiatAmount).toBe("135.63");
    expect(new Date(quote.expiresAt).getTime() - new Date(quote.lockedAt).getTime()).toBe(30_000);
  });

  it("reuses a token rate across networks and payment amounts", async () => {
    let calls = 0;
    const inner = {
      quote: async () => {
        calls += 1;
        return {
          rate: "1356.30000000",
          fiatAmount: "135.63",
          lockedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30_000).toISOString()
        };
      }
    };
    const cached = new CachingFxProvider(inner);

    await cached.quote("USDT", "bsc", "0.1");
    await cached.quote("USDT", "bsc", "0.1");
    await cached.quote("USDT", "bsc", "1");

    expect(calls).toBe(1);
  });

  it("coalesces concurrent requests for the same token", async () => {
    let calls = 0;
    let resolveQuote!: (quote: {
      rate: string;
      lockedAt: string;
      expiresAt: string;
    }) => void;
    const inner = {
      quote: async () => {
        calls += 1;
        return new Promise<{
          rate: string;
          lockedAt: string;
          expiresAt: string;
        }>((resolve) => {
          resolveQuote = resolve;
        });
      }
    };
    const cached = new CachingFxProvider(inner);

    const polygon = cached.quote("USDT", "polygon", "0.1");
    const bsc = cached.quote("USDT", "bsc", "1");
    expect(calls).toBe(1);

    resolveQuote({
      rate: "1356.30000000",
      lockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30_000).toISOString()
    });
    await expect(Promise.all([polygon, bsc])).resolves.toHaveLength(2);
    expect(calls).toBe(1);
  });
});
