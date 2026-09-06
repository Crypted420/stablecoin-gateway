import { z } from "zod";
import { NETWORKS, TOKENS } from "./types.js";

export const EVENT_NAMES = [
  "PaymentDetected",
  "PaymentConfirmed",
  "PaymentRejected",
  "QuoteLocked",
  "SettlementCompleted",
  "SettlementFailed"
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

const envelope = z.object({
  eventId: z.string().uuid(),
  correlationId: z.string().uuid(),
  occurredAt: z.string(),
  attempt: z.number().int().nonnegative().default(0)
});

export const paymentDetected = envelope.extend({
  name: z.literal("PaymentDetected"),
  invoiceId: z.string().uuid(),
  txHash: z.string(),
  logIndex: z.number().int().nonnegative(),
  fromAddress: z.string(),
  toAddress: z.string(),
  amountRaw: z.string(),
  tokenSymbol: z.enum(TOKENS),
  network: z.enum(NETWORKS),
  blockNumber: z.number().int().nonnegative(),
  blockHash: z.string().nullable().optional()
});

export const paymentConfirmed = envelope.extend({
  name: z.literal("PaymentConfirmed"),
  paymentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  merchantId: z.string().uuid(),
  amountRaw: z.string(),
  tokenSymbol: z.enum(TOKENS),
  network: z.enum(NETWORKS),
  confirmations: z.number().int().nonnegative()
});

export const paymentRejected = envelope.extend({
  name: z.literal("PaymentRejected"),
  paymentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  reason: z.enum(["underpaid", "overpaid", "orphaned", "invoice_expired"])
});

export const quoteLocked = envelope.extend({
  name: z.literal("QuoteLocked"),
  settlementId: z.string().uuid(),
  paymentId: z.string().uuid(),
  merchantId: z.string().uuid(),
  rate: z.string(),
  amountNgn: z.string()
});

export const settlementCompleted = envelope.extend({
  name: z.literal("SettlementCompleted"),
  settlementId: z.string().uuid(),
  paymentId: z.string().uuid(),
  merchantId: z.string().uuid(),
  amountNgn: z.string(),
  providerReference: z.string()
});

export const settlementFailed = envelope.extend({
  name: z.literal("SettlementFailed"),
  settlementId: z.string().uuid(),
  paymentId: z.string().uuid(),
  merchantId: z.string().uuid(),
  reason: z.string(),
  attempts: z.number().int().nonnegative()
});

export const domainEvent = z.discriminatedUnion("name", [
  paymentDetected,
  paymentConfirmed,
  paymentRejected,
  quoteLocked,
  settlementCompleted,
  settlementFailed
]);

export type PaymentDetected = z.infer<typeof paymentDetected>;
export type PaymentConfirmed = z.infer<typeof paymentConfirmed>;
export type PaymentRejected = z.infer<typeof paymentRejected>;
export type QuoteLocked = z.infer<typeof quoteLocked>;
export type SettlementCompleted = z.infer<typeof settlementCompleted>;
export type SettlementFailed = z.infer<typeof settlementFailed>;
export type DomainEvent = z.infer<typeof domainEvent>;

export function parseEvent(raw: unknown): DomainEvent {
  return domainEvent.parse(raw);
}

export function newEnvelope(correlationId?: string) {
  return {
    eventId: crypto.randomUUID(),
    correlationId: correlationId ?? crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    attempt: 0
  };
}

export function paymentKey(txHash: string, logIndex: number): string {
  return `${txHash.toLowerCase()}:${logIndex}`;
}
