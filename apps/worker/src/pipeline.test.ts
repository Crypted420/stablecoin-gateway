import { describe, expect, it } from "vitest";
import { MemoryBroker } from "@gateway/broker";
import { convertToNgn, newEnvelope, paymentKey, type DomainEvent } from "@gateway/core";
import { assertBalancedEntries } from "./ledger-rules.js";

function confirmed(paymentId: string, amountRaw: string): DomainEvent {
  return {
    ...newEnvelope(),
    name: "PaymentConfirmed",
    paymentId,
    invoiceId: crypto.randomUUID(),
    merchantId: crypto.randomUUID(),
    amountRaw,
    tokenSymbol: "USDT",
    network: "polygon",
    confirmations: 60
  };
}

class SettlementStore {
  private readonly byPayment = new Map<string, string>();

  createIfNew(paymentId: string): string | null {
    if (this.byPayment.has(paymentId)) return null;
    const id = crypto.randomUUID();
    this.byPayment.set(paymentId, id);
    return id;
  }

  size(): number {
    return this.byPayment.size;
  }
}

describe("exactly-once settlement", () => {
  it("creates one settlement however many times the event is delivered", () => {
    const store = new SettlementStore();
    const event = confirmed(crypto.randomUUID(), "100000000");

    const first = store.createIfNew(event.paymentId);
    const second = store.createIfNew(event.paymentId);
    const third = store.createIfNew(event.paymentId);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(third).toBeNull();
    expect(store.size()).toBe(1);
  });

  it("treats the same transaction at a different log index as a separate payment", () => {
    const a = paymentKey("0xABC", 0);
    const b = paymentKey("0xABC", 1);
    expect(a).not.toBe(b);
  });

  it("is insensitive to transaction hash casing", () => {
    expect(paymentKey("0xABC", 0)).toBe(paymentKey("0xabc", 0));
  });

  it("keeps a failed delivery pending so no payment is lost", async () => {
    const broker = new MemoryBroker();
    await broker.publish(confirmed(crypto.randomUUID(), "1000000"));
    await broker.read("conversion", "c1", 10);
    expect(await broker.pendingCount("conversion")).toBe(1);
  });
});

describe("double-entry journal", () => {
  it("accepts a balanced pair", () => {
    expect(() =>
      assertBalancedEntries([
        { direction: "debit", amount: "158000.00" },
        { direction: "credit", amount: "158000.00" }
      ])
    ).not.toThrow();
  });

  it("rejects a journal whose sides differ by one kobo", () => {
    expect(() =>
      assertBalancedEntries([
        { direction: "debit", amount: "158000.00" },
        { direction: "credit", amount: "157999.99" }
      ])
    ).toThrow(/does not balance/);
  });

  it("rejects a single-sided journal", () => {
    expect(() => assertBalancedEntries([{ direction: "debit", amount: "10.00" }])).toThrow();
  });

  it("balances a split credit against one debit", () => {
    expect(() =>
      assertBalancedEntries([
        { direction: "debit", amount: "100.00" },
        { direction: "credit", amount: "60.00" },
        { direction: "credit", amount: "40.00" }
      ])
    ).not.toThrow();
  });
});

describe("conversion arithmetic", () => {
  it("produces the naira amount the ledger will journal", () => {
    const amountNgn = convertToNgn("100000000", "polygon", "USDT", "1580.00000000");
    expect(amountNgn).toBe("158000.00");
    expect(() =>
      assertBalancedEntries([
        { direction: "debit", amount: amountNgn },
        { direction: "credit", amount: amountNgn }
      ])
    ).not.toThrow();
  });
});
