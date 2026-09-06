import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import {
  alchemySigningKey,
  alchemyWebhookId,
  config,
  type Network,
  type Token
} from "@gateway/core";
import { NETWORK_SPECS } from "@gateway/chain";
import { recordTransferObservation, type DetectionObservation } from "@gateway/db";

interface AlchemyActivity {
  category?: string;
  fromAddress?: string;
  toAddress?: string;
  hash?: string;
  blockNum?: string;
  rawContract?: { rawValue?: string; address?: string };
  log?: {
    address?: string;
    data?: string;
    blockNumber?: string;
    transactionHash?: string;
    blockHash?: string;
    logIndex?: string;
    removed?: boolean;
  };
}

interface AlchemyPayload {
  webhookId?: string;
  id?: string;
  type?: string;
  event?: { network?: string; activity?: AlchemyActivity[] };
}

export const alchemyRouter: ExpressRouter = Router();

function networkForWebhook(webhookId: string): Network | null {
  if (webhookId && webhookId === alchemyWebhookId("polygon")) return "polygon";
  if (webhookId && webhookId === alchemyWebhookId("bsc")) return "bsc";
  return null;
}

export function validAlchemySignature(rawBody: Buffer, supplied: string, signingKey: string): boolean {
  if (!supplied || !signingKey) return false;
  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

function tokenForContract(network: Network, address: string): Token | null {
  const normalized = address.toLowerCase();
  for (const [token, configuredAddress] of Object.entries(NETWORK_SPECS[network].tokens)) {
    if (configuredAddress?.toLowerCase() === normalized) return token as Token;
  }
  return null;
}

function hexInteger(value: string | undefined): number | null {
  if (!value || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const parsed = Number(BigInt(value));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isAddress(value: string | undefined): value is string {
  return Boolean(value && /^0x[0-9a-f]{40}$/i.test(value));
}

export function observationsFromAlchemy(
  payload: AlchemyPayload,
  network: Network
): DetectionObservation[] {
  if (payload.type !== "ADDRESS_ACTIVITY") return [];
  const observations: DetectionObservation[] = [];
  for (const activity of payload.event?.activity ?? []) {
    if (!["token", "erc20"].includes(activity.category?.toLowerCase() ?? "")) continue;
    if (activity.log?.removed) continue;
    if (!isAddress(activity.fromAddress) || !isAddress(activity.toAddress)) continue;
    const contractAddress = activity.rawContract?.address ?? activity.log?.address;
    if (!isAddress(contractAddress)) continue;
    const tokenSymbol = tokenForContract(network, contractAddress);
    if (!tokenSymbol) continue;
    const rawValue = activity.rawContract?.rawValue ?? activity.log?.data;
    if (!rawValue || !/^0x[0-9a-f]+$/i.test(rawValue)) continue;
    const amountRaw = BigInt(rawValue);
    if (amountRaw <= 0n) continue;
    const txHash = activity.log?.transactionHash ?? activity.hash;
    const logIndex = hexInteger(activity.log?.logIndex);
    const blockNumber = hexInteger(activity.log?.blockNumber ?? activity.blockNum);
    if (!txHash || !/^0x[0-9a-f]{64}$/i.test(txHash) || logIndex === null || blockNumber === null) {
      continue;
    }
    observations.push({
      network,
      tokenSymbol,
      txHash,
      logIndex,
      fromAddress: activity.fromAddress,
      toAddress: activity.toAddress,
      amountRaw: amountRaw.toString(),
      blockNumber,
      blockHash: activity.log?.blockHash ?? null
    });
  }
  return observations;
}

alchemyRouter.post("/", async (req: Request, res: Response) => {
  if (config().CHAIN_DETECTION_MODE !== "alchemy") {
    res.status(503).json({ error: "alchemy_webhook_disabled" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "raw_body_required" });
    return;
  }

  let payload: AlchemyPayload;
  try {
    payload = JSON.parse(req.body.toString("utf8")) as AlchemyPayload;
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  const network = networkForWebhook(payload.webhookId ?? "");
  if (!network) {
    res.status(401).json({ error: "unknown_webhook" });
    return;
  }
  const suppliedSignature = req.header("x-alchemy-signature") ?? "";
  if (!validAlchemySignature(req.body, suppliedSignature, alchemySigningKey(network))) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const observations = observationsFromAlchemy(payload, network);
  let accepted = 0;
  for (const observation of observations) {
    if ((await recordTransferObservation(observation)) === "accepted") accepted += 1;
  }
  res.status(200).json({ received: observations.length, accepted });
});
