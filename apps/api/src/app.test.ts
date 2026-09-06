import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError, resetConfig } from "@gateway/core";
import type { BankDirectory } from "@gateway/providers";
import { createApp } from "./app.js";
import { setBankDirectoryForTests } from "./bank-directory.js";

const app = createApp();
const savedAdminKey = process.env.ADMIN_API_KEY;
const savedDetectionMode = process.env.CHAIN_DETECTION_MODE;
const savedPolygonWebhookId = process.env.ALCHEMY_POLYGON_WEBHOOK_ID;
const savedPolygonSigningKey = process.env.ALCHEMY_POLYGON_SIGNING_KEY;

const unconfigured: BankDirectory = {
  listBanks: async () => {
    throw new AppError("PAYSTACK_SECRET_KEY is not set", 500, "banks_unconfigured");
  },
  resolveAccount: async () => {
    throw new AppError("PAYSTACK_SECRET_KEY is not set", 500, "banks_unconfigured");
  }
};

beforeEach(() => {
  setBankDirectoryForTests(unconfigured);
  delete process.env.ADMIN_API_KEY;
  delete process.env.CHAIN_DETECTION_MODE;
  delete process.env.ALCHEMY_POLYGON_WEBHOOK_ID;
  delete process.env.ALCHEMY_POLYGON_SIGNING_KEY;
  resetConfig();
});

afterAll(() => {
  if (savedAdminKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = savedAdminKey;
  if (savedDetectionMode === undefined) delete process.env.CHAIN_DETECTION_MODE;
  else process.env.CHAIN_DETECTION_MODE = savedDetectionMode;
  if (savedPolygonWebhookId === undefined) delete process.env.ALCHEMY_POLYGON_WEBHOOK_ID;
  else process.env.ALCHEMY_POLYGON_WEBHOOK_ID = savedPolygonWebhookId;
  if (savedPolygonSigningKey === undefined) delete process.env.ALCHEMY_POLYGON_SIGNING_KEY;
  else process.env.ALCHEMY_POLYGON_SIGNING_KEY = savedPolygonSigningKey;
  resetConfig();
});

describe("API surface", () => {
  it("says the bank directory is unconfigured rather than inventing a bank list", async () => {
    const response = await request(app).get("/api/banks");
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("banks_unconfigured");
  });

  it("validates the account number and bank code before resolving", async () => {
    const response = await request(app)
      .post("/api/merchants/resolve")
      .send({ bankAccountNumber: "12", bankCode: "x" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_failed");
    expect(response.body.details.length).toBe(2);
  });

  it("will not resolve an account without a configured bank directory", async () => {
    const response = await request(app)
      .post("/api/merchants/resolve")
      .send({ bankAccountNumber: "0123456789", bankCode: "058" });
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("banks_unconfigured");
  });

  it("carries no registration surface", async () => {
    const response = await request(app).post("/api/merchants").send({});
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("not_found");
  });

  it("answers 404 with a structured body for an unknown endpoint", async () => {
    const response = await request(app).get("/api/nope");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("not_found");
  });

  it("exposes metrics in Prometheus text format", async () => {
    const response = await request(app).get("/api/system/metrics");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
  });

  it("carries no authentication surface", async () => {
    const login = await request(app).post("/api/auth/login").send({});
    const register = await request(app).post("/api/auth/register").send({});
    expect(login.status).toBe(404);
    expect(register.status).toBe(404);
  });

  it("keeps payout and operational administration closed until an admin key is configured", async () => {
    const admin = await request(app).get("/api/admin/overview");
    const deadLetters = await request(app).get("/api/system/dead-letters");
    expect(admin.status).toBe(503);
    expect(deadLetters.status).toBe(503);
  });

  it("rejects an incorrect admin key before querying administration data", async () => {
    process.env.ADMIN_API_KEY = "correct-key";
    resetConfig();
    const response = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", "Bearer wrong-key");
    expect(response.status).toBe(401);
  });

  it("accepts a correctly signed raw Alchemy webhook payload", async () => {
    process.env.CHAIN_DETECTION_MODE = "alchemy";
    process.env.ALCHEMY_POLYGON_WEBHOOK_ID = "wh_polygon";
    process.env.ALCHEMY_POLYGON_SIGNING_KEY = "polygon-signing-key";
    resetConfig();
    const rawBody = JSON.stringify({
      webhookId: "wh_polygon",
      type: "ADDRESS_ACTIVITY",
      event: { network: "MATIC_MAINNET", activity: [] }
    });
    const signature = createHmac("sha256", "polygon-signing-key")
      .update(rawBody)
      .digest("hex");

    const response = await request(app)
      .post("/api/webhooks/alchemy")
      .set("Content-Type", "application/json")
      .set("X-Alchemy-Signature", signature)
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: 0, accepted: 0 });
  });

  it("rejects an Alchemy payload whose signature does not match", async () => {
    process.env.CHAIN_DETECTION_MODE = "alchemy";
    process.env.ALCHEMY_POLYGON_WEBHOOK_ID = "wh_polygon";
    process.env.ALCHEMY_POLYGON_SIGNING_KEY = "polygon-signing-key";
    resetConfig();

    const response = await request(app)
      .post("/api/webhooks/alchemy")
      .set("Content-Type", "application/json")
      .set("X-Alchemy-Signature", "invalid")
      .send(JSON.stringify({ webhookId: "wh_polygon", type: "ADDRESS_ACTIVITY" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("invalid_signature");
  });
});
