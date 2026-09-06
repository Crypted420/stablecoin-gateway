import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConfig } from "@gateway/core";
import { executePayout } from "./payout-bridge.js";
import { runReconciliation } from "./reconciliation-bridge.js";

vi.mock("axios", () => ({
  default: { post: vi.fn() }
}));

const post = vi.mocked(axios.post);

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_API_KEY;
  resetConfig();
});

describe("protected worker bridges", () => {
  it("forwards the admin key when retrying a payout", async () => {
    process.env.ADMIN_API_KEY = "evaluation-admin-key";
    resetConfig();
    post.mockResolvedValue({ status: 200, data: { executed: true } });

    await expect(executePayout("settlement-1")).resolves.toEqual({ ok: true });
    expect(post).toHaveBeenCalledWith(
      "/settlements/settlement-1/execute",
      {},
      expect.objectContaining({
        headers: { Authorization: "Bearer evaluation-admin-key" }
      })
    );
  });

  it("forwards the admin key for an evaluation reconciliation run", async () => {
    process.env.ADMIN_API_KEY = "evaluation-admin-key";
    resetConfig();
    const report = { balanced: true };
    post.mockResolvedValue({ status: 200, data: report });

    await expect(
      runReconciliation("2026-01-01T00:00:00.000Z", "2026-01-01T01:00:00.000Z")
    ).resolves.toEqual({ ok: true, report });
    expect(post).toHaveBeenCalledWith(
      "/reconciliation/run",
      {
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-01-01T01:00:00.000Z"
      },
      expect.objectContaining({
        headers: { Authorization: "Bearer evaluation-admin-key" }
      })
    );
  });
});
