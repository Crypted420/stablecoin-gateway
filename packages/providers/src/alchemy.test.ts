import { describe, expect, it, vi } from "vitest";
import type { AxiosInstance } from "axios";
import { AlchemyNotifyClient } from "./alchemy.js";

describe("AlchemyNotifyClient", () => {
  it("adds deposit addresses using the idempotent Notify endpoint", async () => {
    const patch = vi.fn().mockResolvedValue({ status: 200, data: {} });
    const client = new AlchemyNotifyClient(
      "notify-token",
      { polygon: "wh_polygon", bsc: "wh_bsc" },
      { patch } as unknown as AxiosInstance
    );

    await client.addAddresses("polygon", [
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000001"
    ]);

    expect(patch).toHaveBeenCalledOnce();
    expect(patch).toHaveBeenCalledWith(
      "/update-webhook-addresses",
      {
        webhook_id: "wh_polygon",
        addresses_to_add: ["0x0000000000000000000000000000000000000001"],
        addresses_to_remove: []
      },
      expect.objectContaining({ headers: expect.objectContaining({ "X-Alchemy-Token": "notify-token" }) })
    );
  });

  it("fails closed when the selected network has no webhook id", async () => {
    const client = new AlchemyNotifyClient(
      "notify-token",
      { polygon: "", bsc: "wh_bsc" },
      {} as AxiosInstance
    );
    await expect(
      client.addAddresses("polygon", ["0x0000000000000000000000000000000000000001"])
    ).rejects.toMatchObject({ code: "alchemy_notify_unconfigured" });
  });
});
