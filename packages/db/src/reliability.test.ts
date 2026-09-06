import type { QueryResult } from "pg";
import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@gateway/core";
import type { Executor } from "./pool.js";
import { enqueue, claimBatch } from "./repositories/outbox.js";
import { insertPaymentIfNew } from "./repositories/payments.js";
import { assertBalanced } from "./repositories/ledger.js";

function executor(
  handler: (sql: string, values: unknown[] | undefined) => Partial<QueryResult<never>>
): Executor {
  return {
    query: async (sql: string, values?: unknown[]) => ({
      command: "",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [],
      ...handler(sql, values)
    })
  } as unknown as Executor;
}

const event: DomainEvent = {
  name: "PaymentDetected",
  eventId: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-08-31T00:00:00.000Z",
  attempt: 0,
  invoiceId: "33333333-3333-4333-8333-333333333333",
  txHash: "0xabc",
  logIndex: 0,
  fromAddress: "0xfrom",
  toAddress: "0xto",
  amountRaw: "1000000",
  tokenSymbol: "USDC",
  network: "polygon",
  blockNumber: 100,
  blockHash: "0xblock"
};

describe("reliability repositories", () => {
  it("enqueues a domain event with its stable event id", async () => {
    let captured: unknown[] | undefined;
    await enqueue(
      event,
      executor((_sql, values) => {
        captured = values;
        return {};
      })
    );
    expect(captured).toEqual([event.eventId, JSON.stringify(event)]);
  });

  it("claims outbox rows with a durable attempt count", async () => {
    const claimed = await claimBatch(
      "worker-a",
      10,
      executor(() => ({
        rowCount: 1,
        rows: [{ id: "outbox-1", payload: event, attempts: 3 }] as never[]
      }))
    );
    expect(claimed).toEqual([{ id: "outbox-1", event, attempts: 3 }]);
  });

  it("keys payment idempotency by network, transaction hash, and log index", async () => {
    let sql = "";
    let values: unknown[] | undefined;
    const payment = await insertPaymentIfNew(
      {
        invoiceId: event.invoiceId,
        txHash: "0xABC",
        logIndex: 2,
        fromAddress: "0xFROM",
        amountRaw: "1000000",
        network: "polygon",
        tokenSymbol: "USDC",
        blockNumber: 100,
        blockHash: "0xblock"
      },
      executor((query, parameters) => {
        sql = query;
        values = parameters;
        return {};
      })
    );
    expect(payment).toBeNull();
    expect(sql).toContain("ON CONFLICT (network, tx_hash, log_index) DO NOTHING");
    expect(values?.slice(1, 4)).toEqual(["0xabc", 2, "0xfrom"]);
  });

  it("rejects an unbalanced journal before touching the database", () => {
    expect(() =>
      assertBalanced([
        { account: "cash", direction: "debit", amount: "100.00", currency: "NGN" },
        { account: "payable", direction: "credit", amount: "99.99", currency: "NGN" }
      ])
    ).toThrow(/does not balance/);
  });
});
