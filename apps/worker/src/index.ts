import express from "express";
import { Consumer, RedisBroker, type Broker } from "@gateway/broker";
import { LiveChainSource, type ChainSource } from "@gateway/chain";
import {
  EVENT_NAMES,
  NETWORKS,
  assertChainDetectionConfigured,
  config,
  createLogger,
  metrics
} from "@gateway/core";
import { closeDb, connectionHint, db, events as eventRepo, invoices, migrate, outbox } from "@gateway/db";
import { createChainAddressRegistrar, createFxProvider, createPayoutProvider } from "@gateway/providers";
import { ConfirmationService } from "./services/confirmation.js";
import { ConversionService } from "./services/conversion.js";
import { LedgerService } from "./services/ledger.js";
import { ListenerService } from "./services/listener.js";
import { ReconciliationService } from "./services/reconciliation.js";
import { SettlementService } from "./services/settlement.js";
import { OutboxPublisher } from "./services/outbox-publisher.js";
import { WebhookService } from "./services/webhook.js";
import { WalletSweepService } from "./services/wallet-sweep.js";

const log = createLogger("worker");

function chainSource(): ChainSource {
  return new LiveChainSource([...NETWORKS]);
}

async function main(): Promise<void> {
  assertChainDetectionConfigured();
  await migrate();

  const broker: Broker = new RedisBroker();
  const source = chainSource();
  const payout = createPayoutProvider();
  const listener = new ListenerService(source, createChainAddressRegistrar());
  const confirmation = new ConfirmationService(source);
  const conversion = new ConversionService(createFxProvider());
  const settlement = new SettlementService(payout);
  const ledgerService = new LedgerService();
  const reconciliation = new ReconciliationService(source);
  const webhook = new WebhookService();
  const walletSweep = new WalletSweepService();
  const outboxPublisher = new OutboxPublisher(broker);

  const deadLetter = (consumer: string) => async (event: unknown, error: string, attempts: number) => {
    await eventRepo.recordDeadLetter({
      stream: "gateway.events",
      consumer,
      payload: event,
      error,
      attempts
    });
  };

  const consumers = [
    new Consumer(broker, {
      group: "confirmation",
      name: "confirmation",
      handles: ["PaymentDetected"],
      handle: async (event) => {
        if (event.name === "PaymentDetected") await confirmation.handleDetected(event);
      },
      onDeadLetter: deadLetter("confirmation")
    }),
    new Consumer(broker, {
      group: "conversion",
      name: "conversion",
      handles: ["PaymentConfirmed"],
      handle: async (event) => {
        if (event.name === "PaymentConfirmed") await conversion.handleConfirmed(event);
      },
      onDeadLetter: deadLetter("conversion")
    }),
    new Consumer(broker, {
      group: "settlement",
      name: "settlement",
      handles: ["QuoteLocked"],
      handle: async (event) => {
        if (event.name === "QuoteLocked") await settlement.handleQuoteLocked(event);
      },
      onDeadLetter: async (event, error, attempts) => {
        if (event.name === "QuoteLocked") await settlement.markDeadLettered(event.settlementId, error);
        await deadLetter("settlement")(event, error, attempts);
      }
    }),
    new Consumer(broker, {
      group: "ledger",
      name: "ledger",
      handles: ["QuoteLocked", "SettlementCompleted"],
      handle: (event) => ledgerService.handle(event),
      onDeadLetter: deadLetter("ledger")
    }),
    new Consumer(broker, {
      group: "webhook",
      name: "webhook",
      handles: [...EVENT_NAMES],
      handle: (event) => webhook.handle(event),
      onDeadLetter: async (event, error, attempts) => {
        await webhook.markDeadLettered(event, error);
        await deadLetter("webhook")(event, error, attempts);
      }
    })
  ];

  void outboxPublisher.start();
  await listener.start();
  for (const consumer of consumers) void consumer.start();

  let confirmationSweepRunning = false;
  const confirmationSweep = setInterval(() => {
    if (confirmationSweepRunning) return;
    confirmationSweepRunning = true;
    void confirmation
      .sweep()
      .catch((error) => log.error("sweep failed", { error: String(error) }))
      .finally(() => {
        confirmationSweepRunning = false;
      });
  }, config().CONFIRMATION_POLL_INTERVAL_MS);

  const scheduler = setInterval(() => {
    void (async () => {
      const expired = await invoices.expireStaleInvoices();
      if (expired > 0) metrics.increment("invoices_expired_total", {}, expired);
      const report = await reconciliation.run(new Date(Date.now() - 86_400_000), new Date());
      if (!report.balanced) log.warn("reconciliation flagged a discrepancy", { report });
    })().catch((error) => log.error("scheduler failed", { error: String(error) }));
  }, config().RECONCILE_INTERVAL_MS);

  let payoutPollRunning = false;
  const payoutStatusPoll = setInterval(() => {
    if (payoutPollRunning) return;
    payoutPollRunning = true;
    void settlement
      .reconcileSubmitted()
      .catch((error) => log.error("payout status poll failed", { error: String(error) }))
      .finally(() => {
        payoutPollRunning = false;
      });
  }, config().PAYOUT_STATUS_POLL_INTERVAL_MS);

  const control = express();
  control.use(express.json());
  control.get("/health", async (_req, res) => {
    try {
      await db().query("SELECT 1");
      const [pendingOutbox, pendingConfirmation] = await Promise.all([
        outbox.pendingCount(),
        broker.pendingCount("confirmation")
      ]);
      res.json({ status: "ok", database: "up", redis: "up", pendingOutbox, pendingConfirmation });
    } catch (error) {
      res.status(503).json({ status: "degraded", error: String(error) });
    }
  });
  control.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metrics.renderPrometheus());
  });
  control.use((req, res, next) => {
    const key = config().ADMIN_API_KEY;
    if (!key) {
      res.status(503).json({ error: "admin_unconfigured", message: "ADMIN_API_KEY is not configured" });
      return;
    }
    if (req.header("authorization") !== `Bearer ${key}`) {
      res.status(401).json({ error: "unauthorized", message: "A valid admin key is required" });
      return;
    }
    next();
  });
  control.post("/settlements/:id/execute", async (req, res) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    try {
      await settlement.executeById(id);
      res.json({ executed: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("payout retry failed", { settlementId: id, error: message });
      res.status(502).json({ error: "payout_failed", message });
    }
  });

  control.post("/wallet-sweeps/:paymentId/fund", async (req, res) => {
    try {
      res.json({ sweep: await walletSweep.fund(req.params.paymentId!) });
    } catch (error) {
      res.status(502).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });
  control.post("/wallet-sweeps/:paymentId/execute", async (req, res) => {
    try {
      res.json({ sweep: await walletSweep.sweep(req.params.paymentId!) });
    } catch (error) {
      res.status(502).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });
  control.post("/wallet-sweeps/run", async (req, res) => {
    try {
      const action = req.body?.action === "fund" ? "fund" : "sweep";
      res.json(await walletSweep.runAll(action));
    } catch (error) {
      res.status(502).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });
  control.post("/reconciliation/run", async (req, res) => {
    const periodStart = new Date(String(req.body?.periodStart ?? ""));
    const periodEnd = new Date(String(req.body?.periodEnd ?? ""));
    if (
      !Number.isFinite(periodStart.getTime()) ||
      !Number.isFinite(periodEnd.getTime()) ||
      periodStart.getTime() >= periodEnd.getTime()
    ) {
      res.status(400).json({ message: "A valid periodStart before periodEnd is required" });
      return;
    }
    try {
      res.json(await reconciliation.run(periodStart, periodEnd));
    } catch (error) {
      res.status(502).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  const controlPort = Number(process.env.WORKER_CONTROL_PORT ?? 4100);
  const server = control.listen(controlPort, config().WORKER_CONTROL_HOST, () =>
    log.debug("worker running", { controlPort, host: config().WORKER_CONTROL_HOST })
  );

  const shutdown = async () => {
    clearInterval(confirmationSweep);
    clearInterval(scheduler);
    clearInterval(payoutStatusPoll);
    for (const consumer of consumers) consumer.stop();
    outboxPublisher.stop();
    await listener.stop();
    await walletSweep.close();
    await broker.close();
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log.error("worker failed to start", { error: String(error) });
  const hint = connectionHint(error);
  if (hint) log.error(hint);
  process.exit(1);
});
