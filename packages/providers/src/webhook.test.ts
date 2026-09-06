import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { httpClient } from "./http.js";
import { WebhookDispatcher } from "./webhook.js";

const event = {
  name: "SettlementCompleted" as const,
  eventId: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-08-31T00:00:00.000Z",
  attempt: 0,
  settlementId: "33333333-3333-4333-8333-333333333333",
  paymentId: "44444444-4444-4444-8444-444444444444",
  merchantId: "55555555-5555-4555-8555-555555555555",
  amountNgn: "158000.00",
  providerReference: "transfer-1"
};

describe("WebhookDispatcher", () => {
  it("signs the exact JSON body and includes replay-protection headers", async () => {
    let receivedBody = "";
    let receivedHeaders: Record<string, unknown> = {};
    const http = httpClient({
      adapter: async (request) => {
        receivedBody = String(request.data);
        receivedHeaders = request.headers as unknown as Record<string, unknown>;
        return { status: 204, statusText: "", headers: {}, config: request, data: "" };
      }
    });
    vi.spyOn(Date, "now").mockReturnValue(1_777_593_600_000);

    const status = await new WebhookDispatcher("test-secret", http, async () => [
      { address: "93.184.216.34", family: 4 }
    ]).deliver(
      "https://merchant.example/webhooks",
      event
    );

    const timestamp = "1777593600";
    const expected = createHmac("sha256", "test-secret")
      .update(`${timestamp}.${receivedBody}`)
      .digest("hex");
    expect(status).toBe(204);
    expect(receivedHeaders["X-Gateway-Event-Id"]).toBe(event.eventId);
    expect(receivedHeaders["X-Gateway-Timestamp"]).toBe(timestamp);
    expect(receivedHeaders["X-Gateway-Signature"]).toBe(`sha256=${expected}`);
    vi.restoreAllMocks();
  });

  it("rejects non-success responses", async () => {
    const http = httpClient({
      adapter: async (request) => ({
        status: 503,
        statusText: "",
        headers: {},
        config: request,
        data: "temporarily unavailable"
      })
    });

    await expect(
      new WebhookDispatcher("test-secret", http, async () => [
        { address: "93.184.216.34", family: 4 }
      ]).deliver("https://merchant.example/webhooks", event)
    ).rejects.toMatchObject({ code: "webhook_rejected" });
  });

  it("fails closed when the signing secret is missing", async () => {
    await expect(new WebhookDispatcher("").deliver("https://merchant.example/webhooks", event)).rejects.toMatchObject({
      code: "webhook_signing_unconfigured"
    });
  });

  it.each(["http://merchant.example/webhooks", "https://127.0.0.1/webhooks"])(
    "rejects unsafe webhook destination %s",
    async (url) => {
      await expect(new WebhookDispatcher("test-secret").deliver(url, event)).rejects.toMatchObject({
        code: "unsafe_webhook_url"
      });
    }
  );
});
