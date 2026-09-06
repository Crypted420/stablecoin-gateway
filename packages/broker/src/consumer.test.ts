import { describe, expect, it } from "vitest";
import { newEnvelope, type DomainEvent } from "@gateway/core";
import { MemoryBroker } from "./memory-broker.js";
import { Consumer, backoffMs } from "./consumer.js";

function detected(txHash: string): DomainEvent {
  return {
    ...newEnvelope(),
    name: "PaymentDetected",
    invoiceId: crypto.randomUUID(),
    txHash,
    logIndex: 0,
    fromAddress: "0xabc",
    toAddress: "0xdef",
    amountRaw: "1000000",
    tokenSymbol: "USDT",
    network: "polygon",
    blockNumber: 100
  };
}

describe("Consumer", () => {
  it("acknowledges only after the handler resolves", async () => {
    const broker = new MemoryBroker();
    await broker.publish(detected("0x1"));
    const seen: string[] = [];

    const consumer = new Consumer(broker, {
      group: "test",
      name: "test-consumer",
      handles: ["PaymentDetected"],
      handle: async (event) => {
        if (event.name === "PaymentDetected") seen.push(event.txHash);
      }
    });

    await consumer.tick();
    expect(seen).toEqual(["0x1"]);
    expect(await broker.pendingCount("test")).toBe(0);
  });

  it("leaves a failed message pending so it is redelivered", async () => {
    const broker = new MemoryBroker();
    await broker.publish(detected("0x2"));

    const consumer = new Consumer(broker, {
      group: "test",
      name: "flaky",
      handles: ["PaymentDetected"],
      handle: async () => {
        throw new Error("downstream unavailable");
      }
    });

    await consumer.tick();
    expect(await broker.pendingCount("test")).toBe(1);
  });

  it("dead-letters a message that keeps failing", async () => {
    const broker = new MemoryBroker();
    await broker.publish(detected("0x3"));
    let calls = 0;

    const consumer = new Consumer(broker, {
      group: "test",
      name: "always-fails",
      handles: ["PaymentDetected"],
      reclaimIdleMs: 0,
      blockMs: 0,
      backoff: () => 0,
      handle: async () => {
        calls += 1;
        throw new Error("permanent failure");
      }
    });

    for (let i = 0; i < 6; i += 1) await consumer.tick();

    expect(calls).toBeGreaterThanOrEqual(5);
    expect(broker.deadLettered).toHaveLength(1);
    expect(broker.deadLettered[0]?.error).toBe("permanent failure");
    expect(await broker.pendingCount("test")).toBe(0);
  });

  it("ignores events it does not handle but still acknowledges them", async () => {
    const broker = new MemoryBroker();
    await broker.publish(detected("0x4"));
    let handled = 0;

    const consumer = new Consumer(broker, {
      group: "other",
      name: "settlement",
      handles: ["QuoteLocked"],
      handle: async () => {
        handled += 1;
      }
    });

    await consumer.tick();
    expect(handled).toBe(0);
    expect(await broker.pendingCount("other")).toBe(0);
  });

  it("backs off exponentially and caps", () => {
    expect(backoffMs(1)).toBe(500);
    expect(backoffMs(3)).toBe(2000);
    expect(backoffMs(20)).toBe(30_000);
  });
});
