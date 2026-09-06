import { beforeEach, describe, expect, it, vi } from "vitest";
import { newEnvelope, type Network, type PaymentConfirmed } from "@gateway/core";

const mocks = vi.hoisted(() => ({
  insertSettlementIfNew: vi.fn(),
  enqueue: vi.fn()
}));

vi.mock("@gateway/db", () => ({
  settlements: { insertSettlementIfNew: mocks.insertSettlementIfNew },
  outbox: { enqueue: mocks.enqueue },
  withTransaction: async (fn: (client: object) => Promise<unknown>) => fn({})
}));

import { ConversionService } from "./services/conversion.js";

function confirmed(network: Network): PaymentConfirmed {
  return {
    ...newEnvelope(),
    name: "PaymentConfirmed",
    paymentId: crypto.randomUUID(),
    invoiceId: crypto.randomUUID(),
    merchantId: crypto.randomUUID(),
    amountRaw: "123450000",
    tokenSymbol: "cNGN",
    network,
    confirmations: 100
  };
}

describe("cNGN conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertSettlementIfNew.mockResolvedValue({ id: crypto.randomUUID() });
  });

  it.each(["polygon", "bsc"] as const)(
    "stores explicit par valuation on %s",
    async (network) => {
      const fx = {
        quote: vi.fn().mockResolvedValue({
          rate: "1.00000000",
          lockedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 120_000).toISOString()
        })
      };
      const event = confirmed(network);

      await new ConversionService(fx).handleConfirmed(event);

      expect(fx.quote).toHaveBeenCalledWith("cNGN", network, "123.450000");
      expect(mocks.insertSettlementIfNew).toHaveBeenCalledWith(
        {
          paymentId: event.paymentId,
          quoteRate: "1.00000000",
          amountNgn: "123.45",
          valuationBasis: "par"
        },
        {}
      );
      expect(mocks.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ name: "QuoteLocked", rate: "1.00000000", amountNgn: "123.45" }),
        {}
      );
    }
  );
});
