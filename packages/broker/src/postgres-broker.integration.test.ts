import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newEnvelope, type DomainEvent } from "@gateway/core";
import { closeDb, db, type Executor } from "@gateway/db";
import { PostgresBroker } from "./postgres-broker.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("durable PostgreSQL delivery", () => {
  let client: Awaited<ReturnType<ReturnType<typeof db>["connect"]>>;
  let broker: PostgresBroker;
  const event = (): DomainEvent => ({
    ...newEnvelope(), name: "PaymentConfirmed", paymentId: crypto.randomUUID(),
    invoiceId: crypto.randomUUID(), merchantId: crypto.randomUUID(),
    amountRaw: "1000000", tokenSymbol: "USDT", network: "polygon", confirmations: 60
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    client = await db().connect();
    const sql = await readFile(new URL("../../db/migrations/009_durable_broker.sql", import.meta.url), "utf8");
    // Temporary tables isolate this suite from every application table.
    await client.query(sql.replaceAll("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE"));
    broker = new PostgresBroker(client as Executor);
  });
  beforeEach(async () => {
    await client.query("TRUNCATE broker_dead_letters, broker_deliveries, broker_events RESTART IDENTITY");
  });
  afterAll(async () => { client?.release(); await closeDb(); });

  it("publishes once and delivers independently to each consumer group", async () => {
    const payment = event();
    await Promise.all([broker.publish(payment), broker.publish(payment)]);
    expect(await broker.read("ledger", "a", 10, 0)).toHaveLength(1);
    expect(await broker.read("settlement", "b", 10, 0)).toHaveLength(1);
    expect(await broker.read("ledger", "a", 10, 0)).toHaveLength(0);
  });

  it("retains pending events and retry counts after the worker restarts", async () => {
    const payment = event();
    await broker.publish(payment);
    const [delivery] = await broker.read("settlement", "old", 10, 0);
    expect(await broker.incrementAttempt("settlement", delivery!.id)).toBe(1);
    const restarted = new PostgresBroker(client as Executor);
    expect(await restarted.pendingCount("settlement")).toBe(1);
    const recovered = await restarted.reclaim("settlement", "new", 0, 10);
    expect(recovered[0]?.event.eventId).toBe(payment.eventId);
    expect(await restarted.incrementAttempt("settlement", delivery!.id)).toBe(2);
    await restarted.ack("settlement", delivery!.id);
    expect(await restarted.pendingCount("settlement")).toBe(0);
    expect(await restarted.reclaim("settlement", "new", 0, 10)).toHaveLength(0);
  });

  it("does not steal active deliveries and bounds each batch", async () => {
    for (let i = 0; i < 3; i++) await broker.publish(event());
    expect(await broker.read("ledger", "a", 2, 0)).toHaveLength(2);
    expect(await broker.reclaim("ledger", "b", 60_000, 10)).toHaveLength(0);
    expect(await broker.read("ledger", "b", 2, 0)).toHaveLength(1);
    expect(await broker.pendingCount("ledger")).toBe(3);
  });

  it("durably dead-letters failed work without redelivering it", async () => {
    await broker.publish(event());
    const [delivery] = await broker.read("ledger", "a", 10, 0);
    await broker.deadLetter("ledger", delivery!, "provider unavailable");
    await broker.deadLetter("ledger", delivery!, "provider unavailable");
    expect(await broker.pendingCount("ledger")).toBe(0);
    expect(await broker.reclaim("ledger", "b", 0, 10)).toHaveLength(0);
    const { rows } = await client.query("SELECT count(*)::int AS n FROM broker_dead_letters");
    expect(rows[0].n).toBe(1);
  });
});
