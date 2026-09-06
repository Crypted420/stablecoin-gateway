import axios from "axios";
import { describe, expect, it } from "vitest";
import { resetConfig } from "@gateway/core";
import { httpClient } from "./http.js";
import { PaystackPayoutProvider, PayoutTimeoutError, createPayoutProvider } from "./payout.js";

const request = {
  idempotencyKey: "settlement-1",
  amountNgn: "158000.00",
  bankAccountNumber: "0123456789",
  bankCode: "058",
  reason: "Settlement"
};

interface Reply {
  status: number;
  body: unknown;
}

const stub = (replies: Record<string, Reply>, seen?: string[]) =>
  httpClient({
    adapter: async (config) => {
      const path = config.url ?? "";
      seen?.push(path);
      const reply = replies[path] ?? { status: 404, body: { status: false, message: "no stub" } };
      return {
        status: reply.status,
        statusText: "",
        headers: {},
        config,
        data: reply.body
      };
    }
  });

const RECIPIENT_OK: Reply = { status: 200, body: { status: true, data: { recipient_code: "RCP_1" } } };

describe("PaystackPayoutProvider", () => {
  it("creates a recipient and then transfers, returning the provider reference", async () => {
    const seen: string[] = [];
    const provider = new PaystackPayoutProvider(
      "",
      stub(
        {
          "/transferrecipient": RECIPIENT_OK,
          "/transfer": { status: 200, body: { status: true, data: { reference: "trf_9", status: "success" } } }
        },
        seen
      )
    );

    const result = await provider.transfer(request);
    expect(result).toEqual({
      accepted: true,
      conclusive: true,
      providerReference: "trf_9",
      providerStatus: "success"
    });
    expect(seen).toEqual(["/transferrecipient", "/transfer"]);
  });

  it("reports the provider's own reason when a transfer is rejected", async () => {
    const provider = new PaystackPayoutProvider(
      "",
      stub({
        "/transferrecipient": RECIPIENT_OK,
        "/transfer": { status: 400, body: { status: false, message: "Insufficient balance" } }
      })
    );

    await expect(provider.transfer(request)).rejects.toThrow("Insufficient balance");
  });

  it("raises a timeout, not a failure, when the transfer response never arrives", async () => {
    const http = httpClient({
      adapter: async (config) => {
        if (config.url === "/transferrecipient") {
          return { status: 200, statusText: "", headers: {}, config, data: RECIPIENT_OK.body };
        }
        throw new axios.AxiosError("socket hang up", "ECONNRESET", config);
      }
    });

    await expect(new PaystackPayoutProvider("", http).transfer(request)).rejects.toBeInstanceOf(
      PayoutTimeoutError
    );
  });

  it("resolves an uncertain outcome by looking the reference up", async () => {
    const provider = new PaystackPayoutProvider(
      "",
      stub({
        "/transfer/verify/settlement-1": {
          status: 200,
          body: { status: true, data: { reference: "trf_9", status: "success" } }
        }
      })
    );

    expect(await provider.lookup("settlement-1")).toEqual({
      accepted: true,
      conclusive: true,
      providerReference: "trf_9",
      providerStatus: "success"
    });
  });

  it("reports an unknown reference as absent rather than as an error", async () => {
    const provider = new PaystackPayoutProvider("", stub({}));
    expect(await provider.lookup("never-sent")).toBeNull();
  });

  it("does not treat a failed provider transfer as accepted", async () => {
    const provider = new PaystackPayoutProvider(
      "",
      stub({
        "/transfer/verify/settlement-1": {
          status: 200,
          body: { status: true, data: { reference: "trf_9", status: "failed" } }
        }
      })
    );

    expect(await provider.lookup("settlement-1")).toEqual({
      accepted: false,
      conclusive: true,
      providerReference: "trf_9",
      providerStatus: "failed"
    });
  });

  it.each(["pending", "otp", "received"])("does not treat %s as final success", async (providerStatus) => {
    const provider = new PaystackPayoutProvider(
      "",
      stub({
        "/transfer/verify/settlement-1": {
          status: 200,
          body: { status: true, data: { reference: "trf_9", status: providerStatus } }
        }
      })
    );

    expect(await provider.lookup("settlement-1")).toEqual({
      accepted: false,
      conclusive: false,
      providerReference: "trf_9",
      providerStatus
    });
  });
});

describe("automated payout provider", () => {
  it("creates a live Paystack provider without approval feature flags", () => {
    const saved = process.env.PAYSTACK_SECRET_KEY;
    try {
      process.env.PAYSTACK_SECRET_KEY = "sk_live_placeholder";
      resetConfig();
      expect(createPayoutProvider()).toBeInstanceOf(PaystackPayoutProvider);
    } finally {
      if (saved === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = saved;
      resetConfig();
    }
  });
});
