import {
  createLogger,
  metrics,
  newEnvelope,
  type DomainEvent,
  type Network,
  type Token
} from "@gateway/core";
import * as invoices from "./repositories/invoices.js";
import * as outbox from "./repositories/outbox.js";
import { withTransaction } from "./pool.js";

const log = createLogger("payment-detection");

export interface DetectionObservation {
  network: Network;
  tokenSymbol: Token;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  blockNumber: number;
  blockHash: string | null;
}

export type DetectionOutcome = "accepted" | "unknown_address" | "wrong_token";

export async function recordTransferObservation(
  observation: DetectionObservation
): Promise<DetectionOutcome> {
  const invoice = await invoices.findInvoiceByDepositAddress(
    observation.toAddress,
    observation.network
  );
  if (!invoice || !["pending", "detected"].includes(invoice.status)) {
    log.warn("transfer to unknown address ignored", { to: observation.toAddress });
    return "unknown_address";
  }
  if (invoice.tokenSymbol !== observation.tokenSymbol) {
    metrics.increment("payments_rejected_total", { reason: "wrong_token" });
    log.warn("transfer token does not match invoice", {
      invoiceId: invoice.id,
      expected: invoice.tokenSymbol,
      received: observation.tokenSymbol
    });
    return "wrong_token";
  }

  const event: DomainEvent = {
    ...newEnvelope(),
    name: "PaymentDetected",
    invoiceId: invoice.id,
    txHash: observation.txHash,
    logIndex: observation.logIndex,
    fromAddress: observation.fromAddress,
    toAddress: observation.toAddress,
    amountRaw: observation.amountRaw,
    tokenSymbol: observation.tokenSymbol,
    network: observation.network,
    blockNumber: observation.blockNumber,
    blockHash: observation.blockHash
  };

  await withTransaction(async (client) => {
    await outbox.enqueue(event, client);
    await invoices.updateInvoiceStatus(invoice.id, "detected", client);
  });
  metrics.increment("payments_detected_total", { network: observation.network });
  log.info("payment detected", { invoiceId: invoice.id, txHash: observation.txHash });
  return "accepted";
}
